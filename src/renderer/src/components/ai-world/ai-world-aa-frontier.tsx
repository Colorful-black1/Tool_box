import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { JSX, KeyboardEvent } from 'react'

import type { AiWorldAaModel } from '@shared/ai-world-aa'
import { buildAiWorldAaFrontier } from '@shared/ai-world-aa'
import {
  formatAaCostPerTask,
  formatAaIndex,
  formatAaPrice,
  formatAaSpeed
} from '../../lib/ai-world-aa-format'
import { SearchIcon } from '../icons'
import { Popover } from '../popover'

const WIDTH = 1000
const HEIGHT = 420
const MARGIN = { top: 22, right: 26, bottom: 46, left: 66 }
const PLOT_WIDTH = WIDTH - MARGIN.left - MARGIN.right
const PLOT_HEIGHT = HEIGHT - MARGIN.top - MARGIN.bottom

type AaChartMetric = 'cost' | 'price'

interface AaChartPoint {
  model: AiWorldAaModel
  xValue: number
  yValue: number
  x: number
  y: number
  isFrontier: boolean
}

interface AaChartLayout {
  points: AaChartPoint[]
  frontier: AaChartPoint[]
  labels: AaChartPoint[]
  xTicks: number[]
  yTicks: number[]
  xFor: (value: number) => number
  yFor: (value: number) => number
  path: string
}

function axisValue(value: number): string {
  if (value >= 100) return `$${Math.round(value)}`
  if (value >= 1) return `$${Number(value.toFixed(2))}`
  return `$${Number(value.toFixed(3))}`
}

function logTicks(min: number, max: number): number[] {
  const candidates = [
    0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000
  ]
  const hits = candidates.filter((value) => value >= min * 0.99 && value <= max * 1.01)
  if (hits.length >= 3) return hits
  return [min, Math.sqrt(min * max), max]
}

function niceTicks(min: number, max: number): number[] {
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

function buildLayout(models: AiWorldAaModel[], metric: AaChartMetric): AaChartLayout | null {
  const data = buildAiWorldAaFrontier(models, metric)
  if (!data.points.length) return null
  const frontierIds = new Set(data.frontier.map((point) => point.model.id))
  const candidates = data.points.map((point) => ({
    model: point.model,
    xValue: point.value,
    yValue: point.intelligence,
    isFrontier: frontierIds.has(point.model.id)
  }))

  const minX = Math.min(...candidates.map((point) => point.xValue))
  const maxX = Math.max(...candidates.map((point) => point.xValue))
  const minY = Math.min(...candidates.map((point) => point.yValue))
  const maxY = Math.max(...candidates.map((point) => point.yValue))
  const logMinBase = Math.log10(minX)
  const logMaxBase = Math.log10(Math.max(maxX, minX * 1.01))
  const logPad = Math.max(0.04, (logMaxBase - logMinBase) * 0.08)
  const logMin = logMinBase - logPad
  const logMax = logMaxBase + logPad
  const yPad = Math.max(1, (maxY - minY) * 0.08)
  const yMin = minY - yPad
  const yMax = maxY + yPad
  const xFor = (value: number): number =>
    MARGIN.left + ((Math.log10(value) - logMin) / (logMax - logMin)) * PLOT_WIDTH
  const yFor = (value: number): number =>
    MARGIN.top + (1 - (value - yMin) / (yMax - yMin)) * PLOT_HEIGHT

  const points: AaChartPoint[] = candidates.map((point) => ({
    ...point,
    x: xFor(point.xValue),
    y: yFor(point.yValue)
  }))
  const frontierPoints = points
    .filter((point) => point.isFrontier)
    .sort((a, b) => a.xValue - b.xValue)
  const labels = [...frontierPoints]
  for (const point of points
    .filter((point) => !point.isFrontier)
    .sort((a, b) => b.yValue - a.yValue)) {
    if (labels.length >= 9) break
    labels.push(point)
  }

  return {
    points,
    frontier: frontierPoints,
    labels,
    xTicks: logTicks(minX, maxX),
    yTicks: niceTicks(minY, maxY),
    xFor,
    yFor,
    path: frontierPoints.map((point) => `${point.x},${point.y}`).join(' ')
  }
}

interface AiWorldAaFrontierProps {
  models: AiWorldAaModel[]
  onSelect: (model: AiWorldAaModel) => void
}

/** AA 智能 × 成本前沿：X 轴为每任务成本或输出价格，Y 轴为 Intelligence Index。 */
export function AiWorldAaFrontier({ models, onSelect }: AiWorldAaFrontierProps): JSX.Element {
  const [metric, setMetric] = useState<AaChartMetric>('cost')
  const [hovered, setHovered] = useState<AaChartPoint | null>(null)
  const [pinnedId, setPinnedId] = useState<string | null>(null)
  const [locator, setLocator] = useState('')
  const [locatorOpen, setLocatorOpen] = useState(false)
  const [locatorActive, setLocatorActive] = useState(0)
  const locatorBox = useRef<HTMLDivElement>(null)
  const locatorInput = useRef<HTMLInputElement>(null)
  const skipLocatorFocusOpen = useRef(false)
  const locatorId = useId()
  const layout = useMemo(() => buildLayout(models, metric), [models, metric])
  const focusPoint = useMemo(
    () => layout?.points.find((point) => point.model.id === pinnedId) ?? null,
    [layout, pinnedId]
  )
  const locatorMatches = useMemo(() => {
    const keyword = locator.trim().toLowerCase()
    if (!keyword || !layout) return []
    return layout.points
      .filter((point) =>
        [point.model.name, point.model.slug, point.model.creator]
          .filter(Boolean)
          .some((value) => value.toLowerCase().includes(keyword))
      )
      .sort((a, b) => b.yValue - a.yValue || a.model.name.localeCompare(b.model.name))
      .slice(0, 8)
  }, [layout, locator])

  useEffect(() => {
    if (!pinnedId) return
    if (layout?.points.some((point) => point.model.id === pinnedId)) return
    setPinnedId(null)
  }, [layout, pinnedId])

  if (!layout) {
    return (
      <div className="ai-world-frontier-empty" role="status">
        <strong>当前筛选下没有可画的点</strong>
        <span>需要同时具备 AA 智能指数与成本 / 输出价格的模型；清除搜索后再试。</span>
      </div>
    )
  }

  const metricLabel = metric === 'cost' ? '每任务成本' : '输出价格'
  const axisTitle =
    metric === 'cost' ? '每任务成本（USD，对数轴）' : '输出价格（USD / 1M tokens，对数轴）'
  const open = (point: AaChartPoint): void => onSelect(point.model)
  const onKeyDown = (event: KeyboardEvent<SVGCircleElement>, point: AaChartPoint): void => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    open(point)
  }
  const tooltipPoint = hovered ?? focusPoint
  const tooltipClass = tooltipPoint
    ? [tooltipPoint.x > WIDTH * 0.68 ? 'is-right' : '', tooltipPoint.y < 110 ? 'is-below' : '']
        .filter(Boolean)
        .join(' ')
    : ''

  const metricFor = (point: AaChartPoint): string =>
    metric === 'cost' ? formatAaCostPerTask(point.xValue) : formatAaPrice(point.xValue)

  const focusLocator = (): void => {
    if (document.activeElement === locatorInput.current) return
    skipLocatorFocusOpen.current = true
    locatorInput.current?.focus()
  }
  const choosePoint = (point: AaChartPoint): void => {
    setPinnedId(point.model.id)
    setHovered(null)
    setLocator(point.model.name)
    setLocatorOpen(false)
    focusLocator()
  }
  const clearPinned = (): void => {
    setPinnedId(null)
    setLocator('')
    setLocatorOpen(false)
    focusLocator()
  }
  const onLocatorChange = (value: string): void => {
    setLocator(value)
    setLocatorOpen(value.trim().length > 0)
    setLocatorActive(0)
    if (pinnedId) setPinnedId(null)
  }
  const onLocatorKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.nativeEvent.isComposing) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (!locator.trim()) return
      event.preventDefault()
      if (!locatorOpen) {
        setLocatorOpen(true)
        return
      }
      if (locatorMatches.length === 0) return
      setLocatorActive((current) =>
        Math.max(
          0,
          Math.min(locatorMatches.length - 1, current + (event.key === 'ArrowDown' ? 1 : -1))
        )
      )
      return
    }
    if (event.key === 'Enter') {
      if (!locatorMatches.length) return
      event.preventDefault()
      choosePoint(locatorMatches[Math.min(locatorActive, locatorMatches.length - 1)])
      return
    }
    if (event.key === 'Escape') setLocatorOpen(false)
  }

  return (
    <div className="ai-world-frontier-card ai-aa-frontier-card">
      <div className="ai-world-frontier-head">
        <div>
          <p className="ai-world-eyebrow">INTELLIGENCE × COST</p>
          <h4>智能 × 成本前沿</h4>
          <p className="field-hint">
            横轴{metricLabel}、纵轴 Artificial Analysis Intelligence
            Index；金线连接同成本下的智能上限。
          </p>
        </div>
        <div className="ai-world-frontier-actions">
          <div className="ai-world-frontier-legend" role="group" aria-label="成本口径">
            <button
              type="button"
              aria-pressed={metric === 'cost'}
              onClick={() => {
                setMetric('cost')
                setHovered(null)
              }}
            >
              每任务成本
            </button>
            <button
              type="button"
              aria-pressed={metric === 'price'}
              onClick={() => {
                setMetric('price')
                setHovered(null)
              }}
            >
              输出价格
            </button>
          </div>
          <div className="ai-world-locator">
            <div className="ai-world-locator-box" ref={locatorBox}>
              <label className="ai-world-search">
                <SearchIcon />
                <input
                  ref={locatorInput}
                  className="field-input"
                  type="text"
                  value={locator}
                  onChange={(event) => onLocatorChange(event.target.value)}
                  onFocus={() => {
                    if (skipLocatorFocusOpen.current) {
                      skipLocatorFocusOpen.current = false
                      return
                    }
                    if (locator.trim()) setLocatorOpen(true)
                  }}
                  onKeyDown={onLocatorKeyDown}
                  placeholder="在图中定位模型"
                  aria-label="在图中搜索 Artificial Analysis 模型"
                  role="combobox"
                  aria-expanded={locatorOpen && locator.trim().length > 0}
                  aria-controls={`${locatorId}-options`}
                  aria-autocomplete="list"
                  aria-activedescendant={
                    locatorMatches[locatorActive]
                      ? `${locatorId}-option-${locatorActive}`
                      : undefined
                  }
                  autoComplete="off"
                />
              </label>
              {locatorOpen && locator.trim() ? (
                <Popover
                  anchor={locatorBox}
                  align="left"
                  onClose={() => setLocatorOpen(false)}
                  className="ai-world-locator-popover"
                  maxPanelHeight={300}
                >
                  <ul
                    id={`${locatorId}-options`}
                    className="ai-world-locator-list"
                    role="listbox"
                    aria-label="匹配的模型"
                  >
                    {locatorMatches.length ? (
                      locatorMatches.map((point, optionIndex) => (
                        <li key={point.model.id}>
                          <button
                            type="button"
                            role="option"
                            aria-selected={focusPoint?.model.id === point.model.id}
                            id={`${locatorId}-option-${optionIndex}`}
                            className={`ai-world-locator-option${optionIndex === locatorActive ? ' is-active' : ''}`}
                            onMouseMove={() => setLocatorActive(optionIndex)}
                            onClick={() => choosePoint(point)}
                          >
                            <span className="ai-world-locator-name">
                              <strong>{point.model.name}</strong>
                              <small>{point.model.creator || '厂商未公开'}</small>
                            </span>
                            <span className="ai-world-locator-metric">
                              <b>智能 {formatAaIndex(point.yValue)}</b>
                              <small>{metricFor(point)}</small>
                            </span>
                          </button>
                        </li>
                      ))
                    ) : (
                      <li className="ai-world-locator-empty">当前图中没有匹配的模型</li>
                    )}
                  </ul>
                </Popover>
              ) : null}
            </div>
            {focusPoint ? (
              <div className="ai-world-frontier-located" role="status">
                <span>
                  智能 {formatAaIndex(focusPoint.yValue)} · {metricLabel} {metricFor(focusPoint)}
                </span>
                <button type="button" className="btn-ghost btn-mini" onClick={clearPinned}>
                  清除定位
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div className={`ai-world-frontier-plot${focusPoint ? ' has-pin' : ''}`}>
        <svg
          className="ai-world-frontier-svg"
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          role="img"
          aria-label={`Artificial Analysis 智能 × ${metricLabel}前沿图`}
        >
          <title>Artificial Analysis 智能 × {metricLabel}前沿图</title>
          <g className="ai-world-frontier-grid" aria-hidden="true">
            {layout.xTicks.map((tick) => (
              <line
                key={`x-${tick}`}
                x1={layout.xFor(tick)}
                x2={layout.xFor(tick)}
                y1={MARGIN.top}
                y2={MARGIN.top + PLOT_HEIGHT}
              />
            ))}
            {layout.yTicks.map((tick) => (
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
            {layout.xTicks.map((tick) => (
              <text
                key={`x-label-${tick}`}
                x={layout.xFor(tick)}
                y={MARGIN.top + PLOT_HEIGHT + 20}
                textAnchor="middle"
              >
                {axisValue(tick)}
              </text>
            ))}
            {layout.yTicks.map((tick) => (
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
              {axisTitle}
            </text>
            <text
              x={16}
              y={MARGIN.top + PLOT_HEIGHT / 2}
              textAnchor="middle"
              transform={`rotate(-90 16 ${MARGIN.top + PLOT_HEIGHT / 2})`}
              className="ai-world-frontier-axis-title"
            >
              Artificial Analysis Intelligence Index
            </text>
          </g>

          {focusPoint ? (
            <g className="ai-world-frontier-guides" aria-hidden="true">
              <line x1={MARGIN.left} y1={focusPoint.y} x2={focusPoint.x} y2={focusPoint.y} />
              <line
                x1={focusPoint.x}
                y1={focusPoint.y}
                x2={focusPoint.x}
                y2={MARGIN.top + PLOT_HEIGHT}
              />
            </g>
          ) : null}

          <polyline className="ai-world-frontier-line" points={layout.path} aria-hidden="true" />

          {layout.points.map((point) => {
            const isPinned = focusPoint?.model.id === point.model.id
            return (
              <circle
                key={point.model.id}
                className={`ai-world-frontier-dot${point.isFrontier ? ' is-frontier' : ''}${isPinned ? ' is-pinned' : ''}${focusPoint && !isPinned ? ' is-dimmed' : ''}`}
                cx={point.x}
                cy={point.y}
                r={isPinned ? 6.4 : point.isFrontier ? 5.2 : 3.4}
                fill={point.isFrontier ? 'var(--gold)' : 'var(--cyan)'}
                tabIndex={0}
                role="button"
                aria-label={`${point.model.name}，智能指数 ${formatAaIndex(point.yValue)}，${metricLabel} ${metricFor(point)}${isPinned ? '，已定位' : ''}`}
                onMouseEnter={() => setHovered(point)}
                onMouseLeave={() => setHovered(null)}
                onFocus={() => setHovered(point)}
                onBlur={() => setHovered(null)}
                onClick={() => open(point)}
                onKeyDown={(event) => onKeyDown(event, point)}
              />
            )
          })}

          {focusPoint ? (
            <circle
              className="ai-world-frontier-halo"
              cx={focusPoint.x}
              cy={focusPoint.y}
              r={12}
              aria-hidden="true"
            />
          ) : null}

          {layout.labels.map((point) => (
            <text
              key={`label-${point.model.id}`}
              className={`ai-world-frontier-label${focusPoint?.model.id === point.model.id ? ' is-pinned' : ''}`}
              x={point.x + (point.x > WIDTH * 0.82 ? -8 : 8)}
              y={point.y - 8}
              textAnchor={point.x > WIDTH * 0.82 ? 'end' : 'start'}
              aria-hidden="true"
            >
              {point.model.name}
            </text>
          ))}
        </svg>

        {tooltipPoint ? (
          <div
            className={`ai-world-frontier-tooltip ${tooltipClass}`}
            style={{
              left: `${(tooltipPoint.x / WIDTH) * 100}%`,
              top: `${(tooltipPoint.y / HEIGHT) * 100}%`
            }}
            role="status"
          >
            <strong>{tooltipPoint.model.name}</strong>
            <span>{tooltipPoint.model.creator || '厂商未公开'}</span>
            <dl>
              <div>
                <dt>智能指数</dt>
                <dd>{formatAaIndex(tooltipPoint.model.intelligenceIndex)}</dd>
              </div>
              <div>
                <dt>每任务成本</dt>
                <dd>{formatAaCostPerTask(tooltipPoint.model.costPerTask)}</dd>
              </div>
              <div>
                <dt>输出价格</dt>
                <dd>{formatAaPrice(tooltipPoint.model.outputPricePerMTok)}</dd>
              </div>
              <div>
                <dt>输出速度</dt>
                <dd>{formatAaSpeed(tooltipPoint.model.outputTokensPerSecond)}</dd>
              </div>
            </dl>
          </div>
        ) : null}
      </div>

      <div className="ai-world-frontier-foot">
        <span className="field-hint">
          {layout.points.length} 个有智能指数 + {metricLabel} 的模型 · {layout.frontier.length}{' '}
          个前沿点
        </span>
        <span className="field-hint">搜索可定位图中模型；点或前沿卡片打开详情</span>
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
                <small>{point.model.creator || '厂商未公开'}</small>
              </span>
              <span className="ai-world-frontier-model-metric">
                <b>智能 {formatAaIndex(point.yValue)}</b>
                <small>{metricFor(point)}</small>
              </span>
            </button>
          ))}
      </div>
    </div>
  )
}
