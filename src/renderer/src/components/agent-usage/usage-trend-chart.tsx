import { useState } from 'react'
import type { JSX } from 'react'
import { USAGE_CLIENTS } from '@shared/agent-usage'
import type { UsageDaily } from '@shared/agent-usage'
import { formatCompact, formatTokens } from '@shared/usage-format'

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

/** 按 Agent 堆叠的趋势图；趋势不受日期筛选影响，便于切换 7/30/90 天。 */
export function UsageTrendChart({ trend, onPick }: UsageTrendChartProps): JSX.Element {
  const [range, setRange] = useState<(typeof RANGES)[number]>(30)
  const shown = trend.slice(-range)
  const clients = [...new Set(shown.flatMap((day) => day.clients.map((item) => item.client)))]
  const max = shown.reduce((value, day) => Math.max(value, day.total ?? 0), 1)
  const sum = shown.reduce((value, day) => value + (day.total ?? 0), 0)
  const every = Math.max(1, Math.ceil(shown.length / 8))

  return (
    <section className="glass agent-usage-trend" aria-label="用量趋势">
      <header className="agent-usage-trend-head">
        <div>
          <h3>用量趋势</h3>
          <p className="field-hint">
            {shown.length
              ? `${shown.length} 个有记录的日期 · 合计 ${formatCompact(sum)} Token`
              : '当前筛选还没有可按日期绘制的记录'}
          </p>
        </div>
        <div className="agent-usage-range" role="group" aria-label="趋势范围">
          {RANGES.map((value) => (
            <button
              type="button"
              key={value}
              className="btn-ghost"
              aria-pressed={range === value}
              onClick={() => setRange(value)}
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
                title={`${day.date}：${formatTokens(day.total)} Token`}
                onClick={() => onPick(day.date)}
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
          <div className="agent-usage-legend">
            {clients.map((client) => (
              <span key={client}>
                <i
                  aria-hidden="true"
                  style={{
                    background: CLIENT_COLORS[clients.indexOf(client) % CLIENT_COLORS.length]
                  }}
                />
                {USAGE_CLIENTS[client]}
              </span>
            ))}
          </div>
        </>
      ) : null}
    </section>
  )
}
