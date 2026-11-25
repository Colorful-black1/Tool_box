import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import type { JSX } from 'react'

import {
  AI_WORLD_AA_KEY_URL,
  AI_WORLD_AA_MODELS_URL,
  AI_WORLD_AA_SOURCE_LABEL
} from '@shared/ai-world-aa'
import type { AiWorldAaModel, AiWorldAaResult } from '@shared/ai-world-aa'
import { Dropdown } from '../dropdown'
import { RefreshIcon, SearchIcon } from '../icons'
import { useAiWorldAaStore } from '../../stores/ai-world-aa-store'
import { formatDateTime } from '../../lib/ai-world-format'
import {
  formatAaCostPerTask,
  formatAaDate,
  formatAaIndex,
  formatAaLatency,
  formatAaPrice,
  formatAaQuota,
  formatAaSpeed,
  formatAaVersion
} from '../../lib/ai-world-aa-format'
import { AiWorldAaDetail } from './ai-world-aa-detail'
import { AiWorldAaFrontier } from './ai-world-aa-frontier'

const PAGE_SIZE = 30
const CHECK_INTERVAL_MS = 5 * 60 * 1000

type AaSortKey = 'intelligence' | 'cost' | 'speed' | 'ttft' | 'price' | 'release'

const SORT_OPTIONS: Array<{ value: AaSortKey; label: string }> = [
  { value: 'intelligence', label: '智能指数（高到低）' },
  { value: 'cost', label: '每任务成本（低到高）' },
  { value: 'speed', label: '输出速度（高到低）' },
  { value: 'ttft', label: '首字延迟（低到高）' },
  { value: 'price', label: '输出价格（低到高）' },
  { value: 'release', label: '发布日期（新到旧）' }
]

interface AiWorldAaBoardProps {
  onOpenSource: (url: string) => void
  /** 打开数据来源弹窗；传 'aa' 时直接展开 Key 配置。 */
  onOpenSources: (focus?: 'aa') => void
}

function indexValue(model: AiWorldAaModel, key: AaSortKey): number | string | null {
  if (key === 'intelligence') return model.intelligenceIndex
  if (key === 'cost') return model.costPerTask
  if (key === 'speed') return model.outputTokensPerSecond
  if (key === 'ttft') return model.timeToFirstTokenSeconds
  if (key === 'price') return model.outputPricePerMTok
  return model.releaseDate
}

function compareRows(a: AiWorldAaModel, b: AiWorldAaModel, key: AaSortKey): number {
  const left = indexValue(a, key)
  const right = indexValue(b, key)
  if (left == null && right == null) return 0
  if (left == null) return 1
  if (right == null) return -1
  if (typeof left === 'string' && typeof right === 'string') return right.localeCompare(left)
  if (typeof left === 'number' && typeof right === 'number') {
    if (key === 'cost' || key === 'ttft' || key === 'price') return left - right
    return right - left
  }
  return 0
}

function summaryLine(result: AiWorldAaResult, rowCount: number): string {
  const state = result.state
  const parts = [`${rowCount} 个模型`]
  const quota = formatAaQuota(state.quotaRemaining)
  if (quota) parts.push(quota)
  return parts.join(' · ')
}

export function AiWorldAaBoard({
  onOpenSource,
  onOpenSources
}: AiWorldAaBoardProps): JSX.Element {
  const result = useAiWorldAaStore((state) => state.result)
  const keyStatus = useAiWorldAaStore((state) => state.keyStatus)
  const loading = useAiWorldAaStore((state) => state.loading)
  const refreshing = useAiWorldAaStore((state) => state.refreshing)
  const error = useAiWorldAaStore((state) => state.error)
  const load = useAiWorldAaStore((state) => state.load)
  const refresh = useAiWorldAaStore((state) => state.refresh)
  const refreshIfStale = useAiWorldAaStore((state) => state.refreshIfStale)
  const loadKeyStatus = useAiWorldAaStore((state) => state.loadKeyStatus)
  const clearError = useAiWorldAaStore((state) => state.clearError)

  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)
  const [sort, setSort] = useState<AaSortKey>('intelligence')
  const [view, setView] = useState<'list' | 'frontier'>('list')
  const [page, setPage] = useState(0)
  const [selected, setSelected] = useState<AiWorldAaModel | null>(null)

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    void loadKeyStatus()
  }, [loadKeyStatus])

  useEffect(() => {
    const timer = setInterval(() => {
      if (!document.hidden) void refreshIfStale()
    }, CHECK_INTERVAL_MS)
    const onVisible = (): void => {
      if (!document.hidden) void refreshIfStale()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [refreshIfStale])

  useEffect(() => {
    setPage(0)
  }, [deferredQuery, sort, view])

  const rows = useMemo(() => {
    const models = result?.snapshot?.models ?? []
    const keyword = deferredQuery.trim().toLowerCase()
    return models
      .filter((model) => {
        if (!keyword) return true
        return [model.name, model.creator, model.slug]
          .filter(Boolean)
          .some((value) => value.toLowerCase().includes(keyword))
      })
      .slice()
      .sort(
        (a, b) =>
          compareRows(a, b, sort) ||
          (b.intelligenceIndex ?? -1) - (a.intelligenceIndex ?? -1) ||
          a.name.localeCompare(b.name)
      )
  }, [result, deferredQuery, sort])

  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
  const safePage = Math.min(page, pageCount - 1)
  const visible = rows.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE)
  const configured = result?.state.configured ?? keyStatus.configured
  const state = result?.state ?? null
  const version = result?.snapshot?.intelligenceIndexVersion ?? null

  return (
    <div className="ai-world-aa-page">
      <section className="ai-world-hero">
        <div>
          <p className="ai-world-eyebrow">ARTIFICIAL ANALYSIS · INTELLIGENCE INDEX</p>
          <h2>AA 模型智能榜</h2>
          <p className="field-hint">
            独立的第三方评测：智能指数、六项行业能力、每任务成本与推理速度；与 ECI
            不直接比较。
          </p>
        </div>
        <div className="tool-controls">
          <button
            type="button"
            className="btn-ghost"
            disabled={refreshing || !configured}
            onClick={() => void refresh(true)}
          >
            <RefreshIcon />
            {refreshing ? '刷新中…' : '刷新'}
          </button>
          <button type="button" className="btn-ghost" onClick={() => onOpenSources('aa')}>
            {configured ? '管理 Key' : '配置 Key'}
          </button>
          <button type="button" className="btn-ghost" onClick={() => onOpenSources()}>
            数据来源
          </button>
        </div>
      </section>

      {error ? (
        <div className="status-banner" role="alert">
          <span>{error}</span>
          <span className="tool-controls">
            <button
              type="button"
              className="btn-ghost"
              onClick={() => {
                clearError()
                void load()
              }}
            >
              重试
            </button>
            <button type="button" className="btn-ghost" onClick={clearError}>
              关闭
            </button>
          </span>
        </div>
      ) : null}

      {(!result?.snapshot && (loading || refreshing)) ? (
        <div aria-busy="true" aria-label="Artificial Analysis 加载中">
          <div className="loading-skeleton" />
          <div className="loading-skeleton" />
          <div className="loading-skeleton" />
        </div>
      ) : null}

      {result && !configured ? (
        <section className="ai-aa-setup" aria-label="配置 Artificial Analysis">
          <div>
            <h3>连接 Artificial Analysis</h3>
            <p className="field-hint">
              需要官方免费 API Key；免费档每 24 小时 100 次请求，只需在数据来源中配置一次。Key
              经系统安全存储加密，仅保存在本机。
            </p>
          </div>
          <div className="tool-controls">
            <button type="button" className="btn-gold" onClick={() => onOpenSources('aa')}>
              配置 API Key
            </button>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => onOpenSource(AI_WORLD_AA_KEY_URL)}
            >
              获取免费 Key
            </button>
          </div>
        </section>
      ) : null}

      {configured && result && !result.snapshot && state?.note ? (
        <div className="status-banner" role="alert">
          <span>{state.note}</span>
          <span className="tool-controls">
            <button type="button" className="btn-ghost" onClick={() => void refresh(true)}>
              重试
            </button>
            <button type="button" className="btn-ghost" onClick={() => onOpenSources('aa')}>
              检查 Key
            </button>
          </span>
        </div>
      ) : null}

      {result?.snapshot ? (
        <>
          <section className="ai-aa-summary" aria-label="AA 榜单说明">
            <div>
              <div className="ai-world-section-title">
                <h3>{AI_WORLD_AA_SOURCE_LABEL} 智能榜</h3>
                <span className={`ai-aa-state${state?.ok ? '' : ' is-error'}`}>
                  {state?.ok ? '官方数据' : '上次缓存'}
                </span>
              </div>
              <p className="field-hint">
                Intelligence Index 由 9 项独立评测组成，主指标越高越好；缺失指标显示「—」而不是
                0。
              </p>
            </div>
            <div className="ai-aa-summary-meta">
              <span>智能指数版本：{formatAaVersion(version)}</span>
              <span>官方数据：{formatDateTime(result.snapshot.generatedAt)}</span>
              <span>
                最近检查：{state?.checkedAt ? formatDateTime(state.checkedAt) : '未知'}
              </span>
              <span>{summaryLine(result, rows.length)}</span>
            </div>
            {state?.note ? <p className="field-hint ai-aa-note">{state.note}</p> : null}
          </section>

          <div className="ai-world-toolbar">
            <label className="ai-world-search">
              <SearchIcon />
              <input
                className="field-input"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索模型、厂商或 Slug"
                aria-label="搜索 Artificial Analysis 模型"
              />
            </label>
            <div className="ai-world-view-switch ai-aa-view-switch" role="group" aria-label="AA 展示方式">
              <button
                type="button"
                aria-pressed={view === 'list'}
                onClick={() => setView('list')}
              >
                列表
              </button>
              <button
                type="button"
                aria-pressed={view === 'frontier'}
                onClick={() => setView('frontier')}
              >
                智能 × 成本前沿
              </button>
            </div>
            {view === 'list' ? (
              <Dropdown
                ariaLabel="排序方式"
                value={sort}
                options={SORT_OPTIONS}
                onChange={(value) => setSort(value as AaSortKey)}
              />
            ) : null}
          </div>

          {view === 'frontier' ? (
            <AiWorldAaFrontier models={rows} onSelect={setSelected} />
          ) : visible.length ? (
            <div className="ai-world-table-wrap">
              <table className="ai-world-table ai-aa-table" aria-label="Artificial Analysis 模型榜">
                <thead>
                  <tr>
                    <th title="当前筛选与排序下的名次">#</th>
                    <th>模型</th>
                    <th>厂商</th>
                    <th>智能指数</th>
                    <th>每任务成本</th>
                    <th>输出速度</th>
                    <th>首字延迟</th>
                    <th>输入价</th>
                    <th>输出价</th>
                    <th>发布</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((model, index) => (
                    <tr key={model.id}>
                      <td className="ai-world-rank">{safePage * PAGE_SIZE + index + 1}</td>
                      <td>
                        <button
                          type="button"
                          className="ai-world-model-button"
                          onClick={() => setSelected(model)}
                        >
                          {model.name}
                        </button>
                        <span className="ai-world-model-id">{model.slug}</span>
                      </td>
                      <td>{model.creator || '—'}</td>
                      <td className="ai-aa-index">{formatAaIndex(model.intelligenceIndex)}</td>
                      <td>{formatAaCostPerTask(model.costPerTask)}</td>
                      <td>{formatAaSpeed(model.outputTokensPerSecond)}</td>
                      <td>{formatAaLatency(model.timeToFirstTokenSeconds)}</td>
                      <td>{formatAaPrice(model.inputPricePerMTok)}</td>
                      <td>{formatAaPrice(model.outputPricePerMTok)}</td>
                      <td className="ai-agent-date">{formatAaDate(model.releaseDate)}</td>
                      <td>
                        <button
                          type="button"
                          className="btn-ghost btn-mini"
                          onClick={() => setSelected(model)}
                        >
                          详情
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="field-hint" role="status">
              没有匹配的模型，换一个关键词试试。
            </p>
          )}

          {view === 'list' && rows.length > PAGE_SIZE ? (
            <div className="ai-world-pager">
              <button
                type="button"
                className="btn-ghost btn-mini"
                disabled={safePage === 0}
                onClick={() => setPage(Math.max(0, safePage - 1))}
              >
                上一页
              </button>
              <span className="field-hint">
                第 {safePage + 1} / {pageCount} 页
              </span>
              <button
                type="button"
                className="btn-ghost btn-mini"
                disabled={safePage >= pageCount - 1}
                onClick={() => setPage(Math.min(pageCount - 1, safePage + 1))}
              >
                下一页
              </button>
            </div>
          ) : null}

          <p className="ai-aa-attribution">
            数据来源：
            <button
              type="button"
              className="ai-world-source-link"
              onClick={() => onOpenSource(AI_WORLD_AA_MODELS_URL)}
            >
              {AI_WORLD_AA_SOURCE_LABEL}
            </button>
            · Intelligence Index {formatAaVersion(version)} · 免费 API
          </p>
        </>
      ) : null}

      {selected ? (
        <AiWorldAaDetail
          model={selected}
          intelligenceIndexVersion={version}
          onClose={() => setSelected(null)}
          onOpenSource={onOpenSource}
        />
      ) : null}
    </div>
  )
}
