import { useCallback, useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import { USAGE_CLIENTS } from '@shared/agent-usage'
import type {
  UsageClient,
  UsageQuery,
  UsageReport,
  UsageSessionView,
  UsageSortKey
} from '@shared/agent-usage'
import { usageCsv } from '@shared/usage-format'
import { Dropdown } from '../dropdown'
import { RefreshIcon } from '../icons'
import { UsageKpis } from './usage-kpis'
import { UsageLedger } from './usage-ledger'
import { UsageRanking } from './usage-ranking'
import { UsageSessionSheet } from './usage-session-sheet'
import { UsageSources } from './usage-sources'
import { UsageTrendChart } from './usage-trend-chart'
import {
  USAGE_PERIODS,
  loadUsagePrefs,
  localDateString,
  periodRange,
  saveUsagePrefs
} from '../../lib/usage-prefs'
import type { UsagePeriod, UsagePrefs } from '../../lib/usage-prefs'

const EXPORT_LIMIT = 50_000

function option(values: string[], label: string): { value: string; label: string }[] {
  return [{ value: '', label }, ...values.map((value) => ({ value, label: value }))]
}

/** 本地用量视图独立于 Agent 连接，离开或隐藏页面后停止周期刷新。 */
export function AgentUsagePage(): JSX.Element {
  const [initial] = useState<UsagePrefs | null>(() => loadUsagePrefs())
  const [period, setPeriod] = useState<UsagePeriod>(initial?.period ?? 'today')
  const [query, setQuery] = useState<UsageQuery>(() => {
    const base: UsageQuery =
      initial?.period === 'custom' && initial.from && initial.to
        ? { from: initial.from, to: initial.to }
        : { ...periodRange(initial?.period ?? 'today') }
    if (initial?.client) base.client = initial.client
    if (initial?.project) base.project = initial.project
    if (initial?.model) base.model = initial.model
    if (initial?.sort) base.sort = initial.sort
    if (initial?.desc !== undefined) base.desc = initial.desc
    return base
  })
  const [report, setReport] = useState<UsageReport | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [sourcesOpen, setSourcesOpen] = useState(false)
  const [actionBusy, setActionBusy] = useState(false)
  const [scanning, setScanning] = useState<UsageClient | ''>('')
  const [exporting, setExporting] = useState(false)
  const [selected, setSelected] = useState<UsageSessionView | null>(null)
  const generation = useRef(0)
  const loading = useRef(false)
  const queued = useRef(false)
  const queuedRefresh = useRef(false)
  const configuring = useRef(false)
  const queryRef = useRef(query)
  const loadRef = useRef<(refresh: boolean) => Promise<void>>(async () => undefined)

  const load = useCallback(async (refresh = false): Promise<void> => {
    const bridge = window.toolbox?.agentUsage
    if (!bridge) {
      setError('当前版本未提供用量统计，请更新并重启应用')
      return
    }
    if (loading.current) {
      queued.current = true
      queuedRefresh.current = queuedRefresh.current || refresh
      return
    }
    const ticket = generation.current
    loading.current = true
    setBusy(true)
    try {
      const next = await bridge.query({ ...queryRef.current, refresh })
      if (ticket === generation.current) {
        setReport(next)
        setError('')
      }
    } catch {
      if (ticket === generation.current) setError('读取失败，请检查数据来源后重试')
    } finally {
      loading.current = false
      if (ticket === generation.current) setBusy(false)
      if (queued.current) {
        queued.current = false
        const nextRefresh = queuedRefresh.current
        queuedRefresh.current = false
        void loadRef.current(nextRefresh)
      }
    }
  }, [])
  useEffect(() => {
    loadRef.current = load
  }, [load])

  const change = useCallback((patch: Partial<UsageQuery>): void => {
    setQuery((old) => ({ ...old, ...patch, offset: patch.offset ?? 0 }))
  }, [])

  useEffect(() => {
    queryRef.current = query
    generation.current++
    void load(false)
  }, [query, load])

  // 页面可见时每分钟对齐日期边界并增量刷新；隐藏后停止，切回时补一次。
  useEffect(() => {
    const tick = (): void => {
      if (document.hidden || configuring.current) return
      if (period !== 'custom') {
        const range = periodRange(period)
        if (range.from !== queryRef.current.from || range.to !== queryRef.current.to) {
          setQuery((old) => ({ ...old, ...range, offset: 0 }))
          return
        }
      }
      void load(false)
    }
    const timer = setInterval(tick, 60_000)
    document.addEventListener('visibilitychange', tick)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [load, period])

  // 来源或模型被新数据淘汰时清掉失效筛选，避免页面停在空结果。
  useEffect(() => {
    if (!report) return
    if (query.project && !report.projects.includes(query.project)) {
      change({ project: undefined })
      return
    }
    if (query.model && !report.models.includes(query.model)) change({ model: undefined })
  }, [report, query.project, query.model, change])

  useEffect(() => {
    saveUsagePrefs({
      period,
      client: query.client,
      project: query.project,
      model: query.model,
      from: query.from,
      to: query.to,
      sort: query.sort,
      desc: query.desc
    })
  }, [
    period,
    query.client,
    query.project,
    query.model,
    query.from,
    query.to,
    query.sort,
    query.desc
  ])

  const sort = query.sort ?? 'time'
  const desc = query.desc ?? true
  const chooseSort = (key: UsageSortKey): void => {
    if (key === sort) change({ desc: !desc })
    else change({ sort: key, desc: true })
  }
  const choosePeriod = (value: string): void => {
    const next = value as UsagePeriod
    setPeriod(next)
    if (next === 'custom') {
      change({
        from: queryRef.current.from ?? localDateString(new Date()),
        to: queryRef.current.to ?? localDateString(new Date())
      })
      return
    }
    const range = periodRange(next)
    change({ from: range.from, to: range.to })
  }
  const pickDate = (date: string): void => {
    setPeriod('custom')
    change({ from: date, to: date })
  }

  const sourceAction = async (client: UsageClient, reset: boolean): Promise<void> => {
    const bridge = window.toolbox?.agentUsage
    if (!bridge || configuring.current || loading.current) return
    configuring.current = true
    setActionBusy(true)
    try {
      if (reset) await bridge.resetSource(client)
      else if (!(await bridge.chooseSource(client))) return
      generation.current++
      await load(true)
    } catch {
      setError('无法更新数据来源，请重试')
    } finally {
      configuring.current = false
      setActionBusy(false)
    }
  }

  const rescan = async (client: UsageClient): Promise<void> => {
    const bridge = window.toolbox?.agentUsage
    if (!bridge || scanning || loading.current) return
    setScanning(client)
    try {
      // 只扫描这一来源：query 带 refresh + client 时主进程不会重扫其它来源。
      await bridge.query({ client, refresh: true, limit: 1 })
      await load(false)
    } catch {
      setError('重新扫描失败，请稍后重试')
    } finally {
      setScanning('')
    }
  }

  const exportCsv = async (): Promise<void> => {
    const bridge = window.toolbox?.agentUsage
    if (!bridge || !report) return
    setExporting(true)
    try {
      const rows: UsageSessionView[] = []
      const base = { ...queryRef.current }
      let offset = 0
      while (offset < report.rowCount && offset < EXPORT_LIMIT) {
        const page = await bridge.query({
          ...base,
          offset,
          limit: Math.min(5000, EXPORT_LIMIT - offset)
        })
        rows.push(...page.rows)
        if (!page.rows.length) break
        offset += page.rows.length
      }
      const blob = new Blob([`\uFEFF${usageCsv(rows)}`], { type: 'text/csv;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `token-usage-${localDateString(new Date())}.csv`
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 0)
    } catch {
      setError('导出失败，请缩小筛选范围后重试')
    } finally {
      setExporting(false)
    }
  }

  const filterModel = (model: string): void => {
    setSelected(null)
    change({ model: model || undefined })
  }
  const filterProject = (project: string): void => {
    setSelected(null)
    change({ project: project || undefined })
  }

  const offset = query.offset ?? 0
  const filtered = Boolean(query.client || query.project || query.model)
  const sourceIssues = (report?.sources ?? []).filter(
    (source) => source.status === 'partial' || source.status === 'error'
  ).length

  return (
    <section className="agent-usage-page view-enter" aria-label="Agent Token 统计">
      <header className="agent-usage-heading">
        <div>
          <h2>Token 用量</h2>
          <p className="field-hint">读取本机历史，无需打开或连接 Agent</p>
        </div>
        <div className="agent-usage-actions">
          <span className="field-hint" role="status">
            {busy
              ? '正在读取本地记录…'
              : report
                ? `更新于 ${new Date(report.scannedAt).toLocaleTimeString('zh-CN')}`
                : '等待扫描'}
          </span>
          <button
            type="button"
            className="btn-ghost"
            aria-expanded={sourcesOpen}
            onClick={() => setSourcesOpen(!sourcesOpen)}
          >
            数据来源{sourceIssues ? ` · ${sourceIssues} 个异常` : ''}
          </button>
          <button
            type="button"
            className="btn-ghost"
            disabled={!report?.rows.length || exporting}
            title="导出当前筛选下的全部会话，最多 50,000 行"
            onClick={() => void exportCsv()}
          >
            {exporting ? '导出中…' : '导出 CSV'}
          </button>
          <button
            type="button"
            className="btn-gold"
            disabled={busy || actionBusy}
            onClick={() => void load(true)}
          >
            <RefreshIcon />
            刷新
          </button>
        </div>
      </header>
      {error ? (
        <div className="status-banner" role="alert">
          {error}
        </div>
      ) : null}
      {sourcesOpen ? (
        <UsageSources
          sources={report?.sources ?? []}
          busy={busy || actionBusy}
          scanning={scanning}
          onChoose={(client) => void sourceAction(client, false)}
          onReset={(client) => void sourceAction(client, true)}
          onRescan={(client) => void rescan(client)}
        />
      ) : null}
      <div className="glass agent-usage-filters" aria-label="用量筛选">
        <Dropdown
          ariaLabel="统计时间"
          value={period}
          onChange={choosePeriod}
          options={USAGE_PERIODS.map((item) => ({ value: item.value, label: item.label }))}
          align="left"
        />
        {period === 'custom' ? (
          <div className="agent-usage-dates">
            <label>
              <span className="sr-only">开始日期</span>
              <input
                type="date"
                className="field-input"
                value={query.from ?? ''}
                max={query.to}
                onChange={(event) => {
                  const from = event.target.value || undefined
                  change({
                    from,
                    ...(from && query.to && from > query.to ? { to: from } : {})
                  })
                }}
              />
            </label>
            <span>至</span>
            <label>
              <span className="sr-only">结束日期</span>
              <input
                type="date"
                className="field-input"
                value={query.to ?? ''}
                min={query.from}
                onChange={(event) => {
                  const to = event.target.value || undefined
                  change({
                    to,
                    ...(to && query.from && to < query.from ? { from: to } : {})
                  })
                }}
              />
            </label>
          </div>
        ) : null}
        <Dropdown
          ariaLabel="统计 Agent"
          value={query.client ?? ''}
          options={[
            { value: '', label: '全部 Agent' },
            ...(Object.keys(USAGE_CLIENTS) as UsageClient[]).map((client) => ({
              value: client,
              label: USAGE_CLIENTS[client]
            }))
          ]}
          onChange={(value) =>
            change({
              client: value ? (value as UsageClient) : undefined,
              project: undefined,
              model: undefined
            })
          }
          searchable
          align="left"
        />
        <Dropdown
          ariaLabel="统计项目"
          value={query.project ?? ''}
          options={option(report?.projects ?? [], '全部项目')}
          onChange={(value) => change({ project: value || undefined })}
          searchable
          align="left"
        />
        <Dropdown
          ariaLabel="统计模型"
          value={query.model ?? ''}
          options={option(report?.models ?? [], '全部模型')}
          onChange={(value) => change({ model: value || undefined })}
          searchable
          align="left"
        />
        {filtered ? (
          <button
            type="button"
            className="btn-ghost"
            onClick={() => change({ client: undefined, project: undefined, model: undefined })}
          >
            清空筛选
          </button>
        ) : null}
      </div>
      {report?.partial ? (
        <div className="status-banner" role="status">
          <span>部分来源或字段不完整，以下为已知用量。</span>
          <button type="button" className="btn-ghost" onClick={() => setSourcesOpen(true)}>
            查看来源
          </button>
        </div>
      ) : null}
      {report?.unknownTime ? (
        <p className="field-hint">
          {report.unknownTime} 条记录时间未知，
          {query.from || query.to
            ? '未计入当前日期范围；切换累计可查看。'
            : '仅计入累计，不纳入每日趋势。'}
        </p>
      ) : null}
      {!report ? (
        <div className="agent-usage-loading" aria-busy="true" aria-label="正在扫描本地用量">
          <div className="loading-skeleton" />
          <div className="loading-skeleton" />
          <div className="loading-skeleton" />
        </div>
      ) : (
        <>
          <UsageKpis report={report} />
          <UsageTrendChart trend={report.trend} onPick={pickDate} />
          <div className="agent-usage-rankings">
            <UsageRanking
              title="按模型"
              items={report.byModel}
              empty="当前筛选没有可排行的模型"
              fallback="模型未知"
              onPick={(model) => change({ model: model || undefined })}
            />
            <UsageRanking
              title="按项目"
              items={report.byProject}
              empty="当前筛选没有可排行的项目"
              fallback="项目未知"
              onPick={(project) => change({ project: project || undefined })}
            />
          </div>
          <UsageLedger
            report={report}
            busy={busy}
            exporting={exporting}
            offset={offset}
            sort={sort}
            desc={desc}
            onSort={chooseSort}
            onPage={(value) => change({ offset: value })}
            onExport={() => void exportCsv()}
            onSelect={setSelected}
          />
        </>
      )}
      {selected ? (
        <UsageSessionSheet
          row={selected}
          onClose={() => setSelected(null)}
          onFilterModel={filterModel}
          onFilterProject={filterProject}
        />
      ) : null}
    </section>
  )
}
