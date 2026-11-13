import { useMemo, useState } from 'react'
import type { JSX, KeyboardEvent } from 'react'

import type { AiWorldFrontierPoint, AiWorldIndex, AiWorldModel } from '@shared/ai-model-world'
import { buildAiWorldFrontier } from '@shared/ai-model-world'
import { formatCount, formatPrice } from '../../lib/ai-world-format'

const WIDTH = 1000
const HEIGHT = 420
const MARGIN = { top: 22, right: 26, bottom: 46, left: 66 }
const PLOT_WIDTH = WIDTH - MARGIN.left - MARGIN.right
const PLOT_HEIGHT = HEIGHT - MARGIN.top - MARGIN.bottom

interface LayoutPoint extends AiWorldFrontierPoint {
  x: number
  y: number
  color: string
  isFrontier: boolean
}

interface FrontierLayout {
  points: LayoutPoint[]
  frontier: LayoutPoint[]
  labels: LayoutPoint[]
  priceTicks: number[]
  eciTicks: number[]
  xFor: (price: number) => number
  yFor: (eci: number) => number
  path: string
}

type FrontierCategory = 'all' | 'frontier' | 'east' | 'west' | 'unknown'

const FRONTIER_CATEGORIES: Array<{ id: FrontierCategory; label: string; color: string }> = [
  { id: 'all', label: '全部', color: 'var(--text-mid)' },
  { id: 'frontier', label: '前沿', color: 'var(--gold)' },
  { id: 'east', label: '国内', color: 'var(--pink)' },
  { id: 'west', label: '国外', color: 'var(--cyan)' },
  { id: 'unknown', label: '未分类', color: 'var(--text-dim)' }
]

function categoryOf(
  index: AiWorldIndex,
  model: AiWorldModel
): Exclude<FrontierCategory, 'all' | 'frontier'> {
  const continent = index.vendors.get(model.vendorId)?.continent
  return continent === 'east' || continent === 'west' ? continent : 'unknown'
}

function axisPrice(value: number): string {
  if (value >= 100) return `$${value.toFixed(0)}`
  if (value >= 1) return `$${Number(value.toFixed(2))}`
  return `$${Number(value.toFixed(3))}`
}

function logPriceTicks(min: number, max: number): number[] {
  const candidates = [
    0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000
  ]
  const hits = candidates.filter((value) => value >= min * 0.99 && value <= max * 1.01)
  if (hits.length >= 3) return hits
  return [min, Math.sqrt(min * max), max]
}

function niceEciTicks(min: number, max: number): number[] {
  const span = Math.max(1, max - min)
  const rawStep = span / 5
  const magnitude = 10 ** Math.floor(Math.log10(rawStep))
  const normalized = rawStep / magnitude
  const step = (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) * magnitude
  const start = Math.ceil(min / step) * step
  const ticks: number[] = []
  for (let value = start; value <= max + step * 0.01; value += step) {
    ticks.push(Math.round(value * 100) / 100)
  }
  return ticks.length >= 2 ? ticks : [min, max]
}

function pointColor(index: AiWorldIndex, model: AiWorldModel): string {
  const continent = index.vendors.get(model.vendorId)?.continent
  if (continent === 'east') return 'var(--pink)'
  if (continent === 'west') return 'var(--cyan)'
  return 'var(--text-dim)'
}

function buildLayout(index: AiWorldIndex, models: AiWorldModel[]): FrontierLayout | null {
  const data = buildAiWorldFrontier(models, index.metricsOf)
  if (data.points.length === 0) return null
  const minPrice = data.priceRange?.[0] ?? data.points[0].price
  const maxPrice = data.priceRange?.[1] ?? minPrice
  const minEci = data.eciRange?.[0] ?? 0
  const maxEci = data.eciRange?.[1] ?? minEci + 1
  const logMinBase = Math.log10(minPrice)
  const logMaxBase = Math.log10(Math.max(maxPrice, minPrice * 1.01))
  const logPad = Math.max(0.04, (logMaxBase - logMinBase) * 0.08)
  const logMin = logMinBase - logPad
  const logMax = logMaxBase + logPad
  const eciPad = Math.max(2, (maxEci - minEci) * 0.08)
  const yMin = minEci - eciPad
  const yMax = maxEci + eciPad
  const xFor = (price: number): number =>
    MARGIN.left + ((Math.log10(price) - logMin) / (logMax - logMin)) * PLOT_WIDTH
  const yFor = (eci: number): number =>
    MARGIN.top + (1 - (eci - yMin) / (yMax - yMin)) * PLOT_HEIGHT
  const frontierIds = new Set(data.frontier.map((point) => point.model.id))
  const points = data.points.map((point) => ({
    ...point,
    x: xFor(point.price),
    y: yFor(point.eci),
    color: pointColor(index, point.model),
    isFrontier: frontierIds.has(point.model.id)
  }))
  const frontier = points.filter((point) => point.isFrontier)
  const labelCandidates = [
    ...frontier,
    ...points
      .filter((point) => !point.isFrontier)
      .sort((a, b) => b.eci - a.eci)
      .slice(0, 3)
  ]
  const labels: LayoutPoint[] = []
  const used = new Set<string>()
  for (const point of labelCandidates) {
    if (used.has(point.model.id)) continue
    used.add(point.model.id)
    labels.push(point)
    if (labels.length >= 9) break
  }
  return {
    points,
    frontier,
    labels,
    priceTicks: logPriceTicks(minPrice, maxPrice),
    eciTicks: niceEciTicks(minEci, maxEci),
    xFor,
    yFor,
    path: frontier.map((point) => `${point.x},${point.y}`).join(' ')
  }
}

export function AiWorldFrontier({
  index,
  models,
  onSelect
}: {
  index: AiWorldIndex
  models: AiWorldModel[]
  onSelect: (model: AiWorldModel) => void
}): JSX.Element {
  const [category, setCategory] = useState<FrontierCategory>('all')
  const [hovered, setHovered] = useState<LayoutPoint | null>(null)
  const filteredModels = useMemo(() => {
    if (category === 'all' || category === 'frontier') return models
    return models.filter((model) => categoryOf(index, model) === category)
  }, [category, index, models])
  const layout = useMemo(
    () => buildLayout(index, category === 'frontier' ? models : filteredModels),
    [category, filteredModels, index, models]
  )
  const shownPoints = layout ? (category === 'frontier' ? layout.frontier : layout.points) : []
  const shownLabels = layout ? (category === 'frontier' ? layout.frontier : layout.labels) : []

  if (!layout || shownPoints.length === 0) {
    return (
      <div className="ai-world-frontier-empty" role="status">
        <strong>当前分类下没有可画的点</strong>
        <span>需要同时具备 ECI 与输出价格的文本模型；切换分类或清除搜索条件后再试。</span>
      </div>
    )
  }

  const changeCategory = (next: FrontierCategory): void => {
    setCategory(next)
    setHovered(null)
  }
  const open = (point: LayoutPoint): void => onSelect(point.model)
  const onKeyDown = (event: KeyboardEvent<SVGCircleElement>, point: LayoutPoint): void => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    open(point)
  }
  const tooltipClass = hovered && hovered.x > WIDTH * 0.68 ? 'is-right' : ''

  return (
    <div className="ai-world-frontier-card">
      <div className="ai-world-frontier-head">
        <div>
          <p className="ai-world-eyebrow">CAPABILITY × PRICE</p>
          <h4>能力-价格前沿</h4>
          <p className="field-hint">
            横轴输出价格、纵轴 ECI；金线连接同价位能力上限。不是 Artificial Analysis 的 IQ /
            每任务成本。
          </p>
        </div>
        <div className="ai-world-frontier-legend" role="group" aria-label="前沿图分类筛选">
          {FRONTIER_CATEGORIES.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={category === item.id}
              onClick={() => changeCategory(item.id)}
            >
              <i style={{ background: item.color }} />
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div className="ai-world-frontier-plot">
        <svg
          className="ai-world-frontier-svg"
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          role="img"
          aria-label="AI 模型能力-价格前沿图"
        >
          <title>AI 模型能力-价格前沿图</title>
          <g className="ai-world-frontier-grid" aria-hidden="true">
            {layout.priceTicks.map((tick) => (
              <line
                key={`x-${tick}`}
                x1={layout.xFor(tick)}
                x2={layout.xFor(tick)}
                y1={MARGIN.top}
                y2={MARGIN.top + PLOT_HEIGHT}
              />
            ))}
            {layout.eciTicks.map((tick) => (
              <line
                key={`y-${tick}`}
                x1={MARGIN.left}
                x2={MARGIN.left + PLOT_WIDTH}
                y1={layout.yFor(tick)}
                y2={layout.yFor(tick)}
              />
            ))}
          </g>
          <g className="ai-world-frontier-axis" aria-hidden="true">
            <line x1={MARGIN.left} x2={MARGIN.left} y1={MARGIN.top} y2={MARGIN.top + PLOT_HEIGHT} />
            <line
              x1={MARGIN.left}
              x2={MARGIN.left + PLOT_WIDTH}
              y1={MARGIN.top + PLOT_HEIGHT}
              y2={MARGIN.top + PLOT_HEIGHT}
            />
            {layout.priceTicks.map((tick) => (
              <text
                key={`x-label-${tick}`}
                x={layout.xFor(tick)}
                y={MARGIN.top + PLOT_HEIGHT + 20}
                textAnchor="middle"
              >
                {axisPrice(tick)}
              </text>
            ))}
            {layout.eciTicks.map((tick) => (
              <text
                key={`y-label-${tick}`}
                x={MARGIN.left - 10}
                y={layout.yFor(tick) + 4}
                textAnchor="end"
              >
                {tick}
              </text>
            ))}
            <text
              x={MARGIN.left + PLOT_WIDTH / 2}
              y={HEIGHT - 8}
              textAnchor="middle"
              className="ai-world-frontier-axis-title"
            >
              输出价格（USD / 1M tokens，对数轴）
            </text>
            <text
              x={16}
              y={MARGIN.top + PLOT_HEIGHT / 2}
              textAnchor="middle"
              transform={`rotate(-90 16 ${MARGIN.top + PLOT_HEIGHT / 2})`}
              className="ai-world-frontier-axis-title"
            >
              Epoch Capabilities Index
            </text>
          </g>

          <polyline className="ai-world-frontier-line" points={layout.path} aria-hidden="true" />

          {shownPoints.map((point) => (
            <circle
              key={point.model.id}
              className={
                point.isFrontier ? 'ai-world-frontier-dot is-frontier' : 'ai-world-frontier-dot'
              }
              cx={point.x}
              cy={point.y}
              r={point.isFrontier ? 5.2 : 3.4}
              fill={point.color}
              tabIndex={0}
              role="button"
              aria-label={`${point.model.name}，ECI ${point.eci.toFixed(1)}，输出价 ${formatPrice(point.price)}`}
              onMouseEnter={() => setHovered(point)}
              onMouseLeave={() => setHovered(null)}
              onFocus={() => setHovered(point)}
              onBlur={() => setHovered(null)}
              onClick={() => open(point)}
              onKeyDown={(event) => onKeyDown(event, point)}
            />
          ))}

          {shownLabels.map((point) => (
            <text
              key={`label-${point.model.id}`}
              className="ai-world-frontier-label"
              x={point.x + (point.x > WIDTH * 0.82 ? -8 : 8)}
              y={point.y - 8}
              textAnchor={point.x > WIDTH * 0.82 ? 'end' : 'start'}
              aria-hidden="true"
            >
              {point.model.name}
            </text>
          ))}
        </svg>

        {hovered ? (
          <div
            className={`ai-world-frontier-tooltip ${tooltipClass}`}
            style={{
              left: `${(hovered.x / WIDTH) * 100}%`,
              top: `${(hovered.y / HEIGHT) * 100}%`
            }}
            role="status"
          >
            <strong>{hovered.model.name}</strong>
            <span>
              {index.vendors.get(hovered.model.vendorId)?.nameZh || hovered.model.vendorId}
            </span>
            <dl>
              <div>
                <dt>ECI</dt>
                <dd>{hovered.eci.toFixed(1)}</dd>
              </div>
              <div>
                <dt>输出价</dt>
                <dd>{formatPrice(hovered.price)}</dd>
              </div>
              <div>
                <dt>上下文</dt>
                <dd>{formatCount(hovered.model.contextWindow)}</dd>
              </div>
              <div>
                <dt>权重</dt>
                <dd>{hovered.model.openWeights ? '开源' : '闭源'}</dd>
              </div>
            </dl>
          </div>
        ) : null}
      </div>

      <div className="ai-world-frontier-foot">
        <span className="field-hint">
          {shownPoints.length} 个有 ECI + 价格的模型 · {layout.frontier.length} 个前沿点
        </span>
        <span className="field-hint">点或前沿卡片可打开模型详情</span>
      </div>

      <div className="ai-world-frontier-list" aria-label="前沿模型">
        {[...layout.frontier]
          .reverse()
          .slice(0, 8)
          .map((point) => (
            <button
              type="button"
              className="ai-world-frontier-model"
              key={point.model.id}
              onClick={() => open(point)}
            >
              <span>
                <strong>{point.model.name}</strong>
                <small>
                  {index.vendors.get(point.model.vendorId)?.nameZh || point.model.vendorId}
                </small>
              </span>
              <span className="ai-world-frontier-model-metric">
                <b>ECI {point.eci.toFixed(1)}</b>
                <small>{formatPrice(point.price)}</small>
              </span>
            </button>
          ))}
      </div>
    </div>
  )
}
