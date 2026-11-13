import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import type { JSX } from 'react'

import type {
  AiWorldChampion,
  AiWorldChampionKey,
  AiWorldMetrics,
  AiWorldModel,
  AiWorldVendor
} from '@shared/ai-model-world'
import { AI_WORLD_KIND_LABELS, aiWorldKindOf, createAiWorldIndex } from '@shared/ai-model-world'
import { Dropdown } from '../dropdown'
import { RefreshIcon, SearchIcon } from '../icons'
import { useAiWorldStore } from '../../stores/ai-world-store'
import {
  formatCount,
  formatDate,
  formatDateTime,
  formatPrice,
  formatRankPercentile
} from '../../lib/ai-world-format'
import { AiWorldDetail } from './ai-world-detail'
import { AiWorldFrontier } from './ai-world-frontier'
import { AiWorldSources } from './ai-world-sources'

const PAGE_SIZE = 30

type RegionFilter = 'all' | 'east' | 'west'
type KindFilter = 'all' | keyof typeof AI_WORLD_KIND_LABELS
type SortKey = 'eci' | 'code' | 'context' | 'price' | 'release'
type ViewMode = 'list' | 'frontier'

const REGION_OPTIONS = [
  { value: 'all', label: '全部地区' },
  { value: 'east', label: '国内' },
  { value: 'west', label: '国外' }
]
const KIND_OPTIONS = [
  { value: 'all', label: '全部类型' },
  ...Object.entries(AI_WORLD_KIND_LABELS).map(([value, label]) => ({ value, label }))
]
const SORT_OPTIONS = [
  { value: 'eci', label: '综合智力' },
  { value: 'code', label: '编程共识' },
  { value: 'context', label: '上下文' },
  { value: 'price', label: '输出价格（低→高）' },
  { value: 'release', label: '发布时间（新→旧）' }
]

const CHAMPION_META: Record<
  AiWorldChampionKey,
  {
    label: string
    figure: (champion: AiWorldChampion, metrics: AiWorldMetrics) => string
    detail: (champion: AiWorldChampion) => string
  }
> = {
  smart: {
    label: '最聪明',
    figure: ({ model }) =>
      model.benchmarks.eci == null ? '—' : `ECI ${model.benchmarks.eci.toFixed(1)}`,
    detail: ({ model }) =>
      model.benchmarks.eci == null ? '暂无第三方综合成绩' : 'Epoch Capabilities Index 当前第一'
  },
  code: {
    label: '最会编程',
    figure: (_champion, metrics) => (metrics.code ? formatRankPercentile(metrics.code.score) : '—'),
    detail: () => '多个第三方编程榜的平均分位最高'
  },
  value: {
    label: '最划算',
    figure: ({ model }) => formatPrice(model.pricing.outputPerMTok),
    detail: () => '智力分位高、价格分位低'
  },
  cheap: {
    label: '最便宜',
    figure: ({ model }) => formatPrice(model.pricing.outputPerMTok),
    detail: () => '有第三方成绩的文本模型里输出最低'
  },
  memory: {
    label: '记性最好',
    figure: ({ model }) => formatCount(model.contextWindow),
    detail: () => '上下文窗口最大'
  },
  newest: {
    label: '最新发布',
    figure: ({ model }) => formatDate(model.releaseDate, model.releaseDatePrecision),
    detail: () => '快照内最新发布的模型'
  },
  east: {
    label: '国内最强',
    figure: ({ model }) =>
      model.benchmarks.eci == null ? '—' : `ECI ${model.benchmarks.eci.toFixed(1)}`,
    detail: () => '国内厂商中综合智力最高'
  },
  open: {
    label: '开源最强',
    figure: ({ model }) =>
      model.benchmarks.eci == null ? '—' : `ECI ${model.benchmarks.eci.toFixed(1)}`,
    detail: () => '开放权重模型中综合智力最高'
  }
}

function daysSince(value: string | null, now: Date): number | null {
  if (!value) return null
  const parts = value.split('-').map(Number)
  const time = Date.UTC(parts[0], (parts[1] ?? 1) - 1, parts[2] ?? 1)
  if (Number.isNaN(time)) return null
  return Math.floor((now.getTime() - time) / 86_400_000)
}

function ChampionCard({
  champion,
  vendor,
  metrics,
  now,
  onOpen
}: {
  champion: AiWorldChampion
  vendor: AiWorldVendor | undefined
  metrics: AiWorldMetrics
  now: Date
  onOpen: () => void
}): JSX.Element {
  const meta = CHAMPION_META[champion.key]
  const age = champion.key === 'newest' ? daysSince(champion.model.releaseDate, now) : null
  const detail = age == null ? meta.detail(champion) : age <= 0 ? '今天发布' : `${age} 天前发布`
  return (
    <button type="button" className="ai-world-champion" onClick={onOpen}>
      <span className="ai-world-champion-label">{meta.label}</span>
      <span className="ai-world-champion-name">{champion.model.name}</span>
      <span className="ai-world-champion-vendor">
        {vendor?.nameZh || vendor?.name || champion.model.vendorId}
      </span>
      <strong>{meta.figure(champion, metrics)}</strong>
      <span className="ai-world-champion-detail">{detail}</span>
    </button>
  )
}

export function AiWorldPage(): JSX.Element {
  const result = useAiWorldStore((state) => state.result)
  const loading = useAiWorldStore((state) => state.loading)
  const refreshing = useAiWorldStore((state) => state.refreshing)
  const error = useAiWorldStore((state) => state.error)
  const load = useAiWorldStore((state) => state.load)
  const refresh = useAiWorldStore((state) => state.refresh)
  const openSource = useAiWorldStore((state) => state.openSource)
  const clearError = useAiWorldStore((state) => state.clearError)

  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)
  const [region, setRegion] = useState<RegionFilter>('all')
  const [kind, setKind] = useState<KindFilter>('all')
  const [openOnly, setOpenOnly] = useState(false)
  const [sort, setSort] = useState<SortKey>('eci')
  const [view, setView] = useState<ViewMode>('list')
  const [page, setPage] = useState(0)
  const [selected, setSelected] = useState<AiWorldModel | null>(null)
  const [sourcesOpen, setSourcesOpen] = useState(false)

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const timer = setInterval(
      () => {
        if (!document.hidden) void useAiWorldStore.getState().refreshIfStale()
      },
      60 * 60 * 1000
    )
    const onVisible = (): void => {
      if (!document.hidden) void useAiWorldStore.getState().refreshIfStale()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  const index = useMemo(() => (result ? createAiWorldIndex(result.snapshot) : null), [result])
  const generatedAt = index ? new Date(index.snapshot.generatedAt) : new Date()
  const now = Number.isNaN(generatedAt.getTime()) ? new Date() : generatedAt

  useEffect(() => {
    setPage(0)
  }, [deferredQuery, region, kind, openOnly, sort])

  const rows = useMemo(() => {
    if (!index) return []
    const keyword = deferredQuery.trim().toLowerCase()
    const filtered = index.alive.filter((model) => {
      const vendor = index.vendors.get(model.vendorId)
      if (region !== 'all' && vendor?.continent !== region) return false
      if (kind !== 'all' && aiWorldKindOf(model) !== kind) return false
      if (openOnly && model.openWeights !== true) return false
      if (!keyword) return true
      return [model.name, model.id, model.vendorId, vendor?.name, vendor?.nameZh]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(keyword))
    })
    return filtered.sort((a, b) => {
      const metricA = index.metricsOf(a)
      const metricB = index.metricsOf(b)
      let delta = 0
      if (sort === 'eci') delta = (metricB.eci ?? -Infinity) - (metricA.eci ?? -Infinity)
      else if (sort === 'code') delta = (metricB.code?.score ?? -1) - (metricA.code?.score ?? -1)
      else if (sort === 'context') delta = (b.contextWindow ?? -1) - (a.contextWindow ?? -1)
      else if (sort === 'price') {
        const priceA = a.pricing.outputPerMTok
        const priceB = b.pricing.outputPerMTok
        delta = (priceA ?? Infinity) - (priceB ?? Infinity)
      } else if (sort === 'release')
        delta = (b.releaseDate ?? '').localeCompare(a.releaseDate ?? '')
      return (
        delta || (metricA.rank ?? Infinity) - (metricB.rank ?? Infinity) || a.id.localeCompare(b.id)
      )
    })
  }, [index, deferredQuery, region, kind, openOnly, sort])

  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
  const safePage = Math.min(page, pageCount - 1)
  const visible = rows.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE)
  const selectedVendor = selected && index ? index.vendors.get(selected.vendorId) : undefined
  const selectedMetrics = selected && index ? index.metricsOf(selected) : null
  const selectedScores = selected && index ? index.scoresOf(selected) : []

  return (
    <div className="ai-world-page view-enter">
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

      {!result && loading ? (
        <div aria-busy="true" aria-label="AI 模型数据加载中">
          <div className="loading-skeleton" />
          <div className="loading-skeleton" />
          <div className="loading-skeleton" />
        </div>
      ) : null}

      {result && index ? (
        <>
          <section className="ai-world-hero">
            <div>
              <p className="ai-world-eyebrow">MODEL LANDSCAPE · 数据快照</p>
              <h2>模型格局</h2>
              <p className="field-hint">
                {formatDateTime(result.snapshot.generatedAt)} · {index.alive.length} 个在役模型 ·{' '}
                {index.vendors.size} 家厂商 ·{' '}
                {result.source === 'network' ? '在线更新' : '本地缓存'}
              </p>
            </div>
            <div className="tool-controls">
              <button
                type="button"
                className="btn-ghost"
                disabled={refreshing}
                onClick={() => void refresh()}
              >
                <RefreshIcon />
                {refreshing ? '刷新中…' : '刷新'}
              </button>
              <button type="button" className="btn-ghost" onClick={() => setSourcesOpen(true)}>
                数据来源
              </button>
            </div>
          </section>

          {result.warning ? (
            <div className="status-banner" role="status">
              <span>{result.warning}</span>
            </div>
          ) : null}

          <section aria-labelledby="ai-world-champions-title">
            <div className="ai-world-section-head">
              <h3 id="ai-world-champions-title">今日格局</h3>
              <span className="field-hint">八个问题，八个当前答案；只从快照计算，不调用 AI</span>
            </div>
            <div className="ai-world-champion-grid">
              {index.champions.map((champion) => (
                <ChampionCard
                  key={champion.key}
                  champion={champion}
                  vendor={champion.vendor}
                  metrics={index.metricsOf(champion.model)}
                  now={now}
                  onOpen={() => setSelected(champion.model)}
                />
              ))}
            </div>
          </section>

          <section aria-labelledby="ai-world-models-title">
            <div className="ai-world-section-head">
              <div className="ai-world-section-title">
                <h3 id="ai-world-models-title">{view === 'list' ? '模型列表' : '能力-价格前沿'}</h3>
                <span className="field-hint">
                  {view === 'list'
                    ? `${rows.length} 个匹配 · 当前显示第 ${safePage + 1} / ${pageCount} 页`
                    : `${rows.length} 个候选 · 金线为同价位 ECI 上限`}
                </span>
              </div>
              <div className="ai-world-view-switch" role="group" aria-label="模型展示方式">
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
                  能力-价格前沿
                </button>
              </div>
            </div>
            <div className="ai-world-toolbar">
              <label className="ai-world-search">
                <SearchIcon />
                <input
                  className="field-input"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="搜索模型、厂商或 ID"
                  aria-label="搜索 AI 模型"
                />
              </label>
              <Dropdown
                ariaLabel="地区筛选"
                value={region}
                options={REGION_OPTIONS}
                onChange={(value) => setRegion(value as RegionFilter)}
              />
              <Dropdown
                ariaLabel="类型筛选"
                value={kind}
                options={KIND_OPTIONS}
                onChange={(value) => setKind(value as KindFilter)}
              />
              {view === 'list' ? (
                <Dropdown
                  ariaLabel="排序方式"
                  value={sort}
                  options={SORT_OPTIONS}
                  onChange={(value) => setSort(value as SortKey)}
                />
              ) : null}
              <label className="tool-check">
                <input
                  type="checkbox"
                  checked={openOnly}
                  onChange={(event) => setOpenOnly(event.target.checked)}
                />
                仅开源
              </label>
            </div>

            {view === 'frontier' ? (
              <AiWorldFrontier index={index} models={rows} onSelect={setSelected} />
            ) : visible.length ? (
              <div className="ai-world-table-wrap">
                <table className="ai-world-table" aria-label="AI 模型列表">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>模型</th>
                      <th className="ai-world-col-vendor">厂商</th>
                      <th className="ai-world-col-kind">类型</th>
                      <th>ECI</th>
                      <th className="ai-world-col-code">编程</th>
                      <th className="ai-world-col-context">上下文</th>
                      <th className="ai-world-col-price">输出价</th>
                      <th className="ai-world-col-date">发布</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((model) => {
                      const metrics = index.metricsOf(model)
                      const vendor = index.vendors.get(model.vendorId)
                      return (
                        <tr key={model.id}>
                          <td className="ai-world-rank">{metrics.rank ?? '—'}</td>
                          <td>
                            <button
                              type="button"
                              className="ai-world-model-button"
                              onClick={() => setSelected(model)}
                            >
                              {model.name}
                            </button>
                            <span className="ai-world-model-id">{model.id}</span>
                          </td>
                          <td className="ai-world-col-vendor">
                            {vendor?.nameZh || vendor?.name || model.vendorId}
                          </td>
                          <td className="ai-world-col-kind">
                            {AI_WORLD_KIND_LABELS[aiWorldKindOf(model)]}
                          </td>
                          <td>{metrics.eci == null ? '未参赛' : metrics.eci.toFixed(1)}</td>
                          <td className="ai-world-col-code">
                            {metrics.code ? formatRankPercentile(metrics.code.score) : '未参赛'}
                          </td>
                          <td className="ai-world-col-context">
                            {formatCount(model.contextWindow)}
                          </td>
                          <td className="ai-world-col-price">
                            {formatPrice(model.pricing.outputPerMTok)}
                          </td>
                          <td className="ai-world-col-date">
                            {formatDate(model.releaseDate, model.releaseDatePrecision)}
                          </td>
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
                      )
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="field-hint" role="status">
                没有匹配的模型，换一个关键词或筛选条件试试。
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
          </section>
        </>
      ) : null}

      {selected && selectedMetrics ? (
        <AiWorldDetail
          model={selected}
          vendor={selectedVendor}
          metrics={selectedMetrics}
          scores={selectedScores}
          onClose={() => setSelected(null)}
          onOpenSource={(url) => void openSource(url)}
        />
      ) : null}

      {sourcesOpen ? (
        <AiWorldSources
          onClose={() => setSourcesOpen(false)}
          onOpenSource={(url) => void openSource(url)}
        />
      ) : null}
    </div>
  )
}
