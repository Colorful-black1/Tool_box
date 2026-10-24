import type { JSX } from 'react'
import type { UsageReport } from '@shared/agent-usage'
import {
  cacheHitRate,
  formatCompact,
  formatCost,
  formatPercent,
  formatTokens
} from '@shared/usage-format'

interface UsageKpisProps {
  report: UsageReport | null
}

interface KpiCard {
  label: string
  value: string
  hint?: string
  /** 悬停显示精确值，KPI 仍保持紧凑。 */
  exact?: string
  /** 花费卡横向占两格，7 张卡在 4 列里正好排成两行。 */
  wide?: boolean
}

/** 顶部指标卡：只展示当前筛选下的已知值，未知不会伪装成 0。 */
export function UsageKpis({ report }: UsageKpisProps): JSX.Element {
  const tokens = report?.tokens
  const cards: KpiCard[] = [
    {
      label: '总 Token',
      value: formatCompact(tokens?.total),
      exact: formatTokens(tokens?.total)
    },
    {
      label: '请求数',
      value: formatCompact(report?.requests),
      exact: formatTokens(report?.requests)
    },
    {
      label: '会话数',
      value: formatCompact(report?.sessions),
      exact: formatTokens(report?.sessions)
    },
    {
      label: '缓存命中率',
      value: formatPercent(cacheHitRate(tokens)),
      hint: '缓存读取 ÷（缓存读取 + 未缓存输入）'
    },
    {
      label: '缓存写入',
      value: formatCompact(tokens?.cacheWrite),
      exact: formatTokens(tokens?.cacheWrite)
    },
    {
      label: '推理',
      value: formatCompact(tokens?.reasoning),
      exact: formatTokens(tokens?.reasoning),
      hint: '部分来源已包含在输出中'
    }
  ]
  if (report && report.cost.reported > 0) {
    cards.push({
      label: '原生上报花费',
      value: formatCost(report.cost.usd),
      exact: `${report.cost.reported}/${report.cost.total} 条记录带花费`,
      hint: '仅 OpenCode 原生上报，不做价格估算',
      wide: true
    })
  }
  return (
    <div className="agent-usage-metrics">
      {cards.map((card) => (
        <div
          className={`glass agent-usage-metric${card.wide ? ' agent-usage-metric-wide' : ''}`}
          key={card.label}
          title={card.exact}
        >
          <span className="field-label">{card.label}</span>
          <strong>{card.value}</strong>
          {card.hint ? <small>{card.hint}</small> : null}
        </div>
      ))}
    </div>
  )
}
