import { useCallback, useEffect, useId, useRef, useState } from 'react'
import type { JSX } from 'react'
import { USAGE_CLIENTS } from '@shared/agent-usage'
import { AgentIdentity } from '../agent-identity'
import type { UsageDaily } from '@shared/agent-usage'
import { formatCompact, formatTokens } from '@shared/usage-format'
import { rollingRange } from '../../lib/usage-prefs'
import { Popover } from '../popover'

const RANGES = [7, 30, 90] as const

/** 只使用主题令牌，保证三套配色下一致。 */
const CLIENT_COLORS = [
  'var(--gold)',
  'var(--cyan)',
  'var(--pink)',
  'var(--gold-dim)',
  'var(--text-mid)'
]

interface UsageTrendChartProps {
  trend: UsageDaily[]
  onPick: (date: string) => void
}

/** 按 Agent 堆叠的趋势图；按自然日截取，和「近 N 天」筛选用同一套日历边界。 */
export function UsageTrendChart({ trend, onPick }: UsageTrendChartProps): JSX.Element {
  const [range, setRange] = useState<(typeof RANGES)[number]>(30)
  const [activeDate, setActiveDate] = useState<string | null>(null)
  const anchor = useRef<HTMLButtonElement>(null)
  const modelList = useRef<HTMLDListElement>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // 提示不接管焦点；Esc 关闭后不再聚焦触发点，避免 onFocus 重新打开。
  const unchangedFocus = useRef<HTMLElement>(null)
  const tooltipId = useId()
  const cancelClose = useCallback((): void => {
    if (closeTimer.current) clearTimeout(closeTimer.current)
    closeTimer.current = null
  }, [])
  const close = useCallback((): void => {
    cancelClose()
    setActiveDate(null)
  }, [cancelClose])
  const open = (day: UsageDaily, button: HTMLButtonElement): void => {
    cancelClose()
    anchor.current = button
    setActiveDate(day.date)
  }
  const deferClose = (): void => {
    cancelClose()
    if (document.activeElement !== anchor.current) closeTimer.current = setTimeout(close, 120)
  }
  useEffect(() => cancelClose, [cancelClose])
  // 不能按「有记录的日期」取条数：历史有间断时会跨出 30 个自然日，合计就会和 KPI 对不上。
  const cutoff = rollingRange(range).from
  const shown = trend.filter((day) => day.date >= cutoff)
  const clients = [...new Set(shown.flatMap((day) => day.clients.map((item) => item.client)))]
  const max = shown.reduce((value, day) => Math.max(value, day.total ?? 0), 1)
  const sum = shown.reduce((value, day) => value + (day.total ?? 0), 0)
  const every = Math.max(1, Math.ceil(shown.length / 8))
  const activeDay = shown.find((day) => day.date === activeDate)

  return (
    <section className="glass agent-usage-trend" aria-label="用量趋势">
      <header className="agent-usage-trend-head">
        <div>
          <h3>用量趋势</h3>
          <p
            className="field-hint"
            title="趋势按自然日统计，只受 Agent / 项目 / 模型筛选影响，不受上方日期范围影响"
          >
            {shown.length
              ? `近 ${range} 天 · ${shown.length} 个有记录的日期 · 合计 ${formatCompact(sum)} Token`
              : `近 ${range} 天还没有可绘制的记录`}
          </p>
        </div>
        <div className="agent-usage-range" role="group" aria-label="趋势范围">
          {RANGES.map((value) => (
            <button
              type="button"
              key={value}
              className="btn-ghost"
              aria-pressed={range === value}
              onClick={() => {
                close()
                setRange(value)
              }}
            >
              {value} 天
            </button>
          ))}
        </div>
      </header>
      {shown.length ? (
        <>
          <div className="agent-usage-chart">
            {shown.map((day, index) => (
              <button
                type="button"
                key={day.date}
                className="agent-usage-chart-column"
                aria-label={`${day.date}，${formatTokens(day.total)} Token，点击筛选该日`}
                aria-describedby={activeDay?.date === day.date ? tooltipId : undefined}
                onMouseEnter={(event) => open(day, event.currentTarget)}
                onMouseLeave={deferClose}
                onFocus={(event) => open(day, event.currentTarget)}
                onBlur={close}
                onKeyDown={(event) => {
                  if (
                    activeDay?.date === day.date &&
                    (event.key === 'ArrowDown' || event.key === 'ArrowUp')
                  ) {
                    event.preventDefault()
                    modelList.current?.scrollBy({ top: event.key === 'ArrowDown' ? 48 : -48 })
                  }
                }}
                onClick={() => {
                  close()
                  onPick(day.date)
                }}
              >
                <span className="agent-usage-chart-stack">
                  {day.clients.map((item) => (
                    <span
                      key={item.client}
                      style={{
                        height: `${((item.total ?? 0) / max) * 100}%`,
                        background:
                          CLIENT_COLORS[clients.indexOf(item.client) % CLIENT_COLORS.length]
                      }}
                    />
                  ))}
                </span>
                <span className="agent-usage-chart-label">
                  {index % every === 0 ? day.date.slice(5) : ''}
                </span>
              </button>
            ))}
          </div>
          {activeDay ? (
            <Popover
              key={activeDay.date}
              anchor={anchor}
              returnFocus={unchangedFocus}
              onClose={close}
              className="agent-usage-trend-tooltip"
              matchAnchorWidth={false}
              maxPanelHeight={360}
            >
              <div
                role="tooltip"
                id={tooltipId}
                onMouseEnter={cancelClose}
                onMouseLeave={deferClose}
              >
                <div className="agent-usage-trend-tooltip-head">
                  <strong>{activeDay.date}</strong>
                  <span>总 Token</span>
                </div>
                <div className="agent-usage-trend-tooltip-total">
                  {formatTokens(activeDay.total)}
                </div>
                <dl className="agent-usage-trend-tooltip-models" ref={modelList}>
                  {activeDay.models?.map((item) => (
                    <div key={item.model}>
                      <dt>{item.model || '模型未知'}</dt>
                      <dd>{formatTokens(item.total)}</dd>
                    </div>
                  ))}
                </dl>
                <p className="field-hint">
                  {activeDay.models?.length
                    ? '按当天及当前筛选汇总 · 可滚动查看，↑↓ 滚动，Esc 关闭'
                    : '当前结果暂无模型明细，请刷新统计；旧版应用需重启更新。'}
                </p>
              </div>
            </Popover>
          ) : null}
          <div className="agent-usage-legend">
            {clients.map((client) => (
              <span key={client}>
                <i
                  aria-hidden="true"
                  style={{
                    background: CLIENT_COLORS[clients.indexOf(client) % CLIENT_COLORS.length]
                  }}
                />
                <AgentIdentity agent={client} label={USAGE_CLIENTS[client]} />
              </span>
            ))}
          </div>
        </>
      ) : null}
    </section>
  )
}
