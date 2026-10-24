import type { JSX } from 'react'
import type { UsageBreakdown } from '@shared/agent-usage'
import { formatCompact, formatCost, formatTokens } from '@shared/usage-format'

interface UsageRankingProps {
  title: string
  items: UsageBreakdown[]
  empty: string
  fallback: string
  onPick?: (key: string) => void
}

/** 模型 / 项目用量排行：条形长度按当前筛选内的相对值，数值保持精确。 */
export function UsageRanking({
  title,
  items,
  empty,
  fallback,
  onPick
}: UsageRankingProps): JSX.Element {
  const max = Math.max(items[0]?.tokens.total ?? 0, 1)
  return (
    <section className="glass agent-usage-rank" aria-label={title}>
      <h3>{title}</h3>
      {items.length ? (
        <div className="agent-usage-rank-list">
          {items.map((item) => {
            const label = item.key || fallback
            const detail = [
              `${formatTokens(item.tokens.total)} Token`,
              item.sessions ? `${item.sessions} 个会话` : '',
              item.requests !== null ? `${formatTokens(item.requests)} 次请求` : '',
              item.costUsd !== null ? `原生花费 ${formatCost(item.costUsd)}` : ''
            ]
              .filter(Boolean)
              .join(' · ')
            return (
              <button
                type="button"
                key={item.key || 'unknown'}
                className="agent-usage-rank-row"
                title={detail}
                disabled={!onPick || !item.key}
                onClick={() => onPick?.(item.key)}
              >
                <span className="agent-usage-rank-name">{label}</span>
                <span className="agent-usage-rank-track" aria-hidden="true">
                  <span style={{ width: `${((item.tokens.total ?? 0) / max) * 100}%` }} />
                </span>
                <strong>{formatCompact(item.tokens.total)}</strong>
              </button>
            )
          })}
        </div>
      ) : (
        <p className="agent-usage-empty">{empty}</p>
      )}
    </section>
  )
}
