import { USAGE_CLIENTS } from './agent-usage'
import type { UsageSessionView, UsageTokens } from './agent-usage'

/** 精确计数：未知保持未知，不能显示成 0。 */
export function formatTokens(value: number | null | undefined): string {
  return value === null || value === undefined ? '未知' : value.toLocaleString('zh-CN')
}

/** KPI 卡片用的紧凑数字：中文万 / 亿，保留一位有效小数。 */
export function formatCompact(value: number | null | undefined): string {
  if (value === null || value === undefined) return '未知'
  const abs = Math.abs(value)
  if (abs < 10_000) return value.toLocaleString('zh-CN')
  if (abs < 100_000_000) return `${trim(value / 10_000, 1)} 万`
  return `${trim(value / 100_000_000, 2)} 亿`
}

function trim(value: number, digits: number): string {
  return value.toFixed(digits).replace(/\.0+$/, '')
}

/** 花费只来自原生上报；未上报写“未上报”，不能显示为 0。 */
export function formatCost(value: number | null | undefined): string {
  if (value === null || value === undefined) return '未上报'
  if (value > 0 && value < 0.01) return '<0.01 USD'
  return `${value.toFixed(2)} USD`
}

/** 缓存命中率 = 缓存读取 /（缓存读取 + 未缓存输入）；缺字段时返回 null。 */
export function cacheHitRate(tokens: UsageTokens | null | undefined): number | null {
  const read = tokens?.cacheRead
  const input = tokens?.input
  if (read === null || read === undefined || input === null || input === undefined) return null
  const total = read + input
  return total > 0 ? read / total : null
}

export function formatPercent(value: number | null | undefined): string {
  return value === null || value === undefined ? '未知' : `${(value * 100).toFixed(1)}%`
}

export function formatDateTime(value: number | null | undefined): string {
  return value === null || value === undefined
    ? '时间未知'
    : new Date(value).toLocaleString('zh-CN')
}

/** CSV 单元格：逗号、引号、换行都按 RFC 4180 处理。 */
export function csvCell(value: string | number | null | undefined): string {
  const text = value === null || value === undefined ? '' : String(value)
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

const CSV_HEADER = [
  'Agent',
  '时间',
  '项目',
  '会话',
  '模型',
  '请求数',
  '未缓存输入',
  '输出',
  '缓存读取',
  '缓存写入',
  '推理',
  '总 Token',
  '花费 USD'
]

/** 导出当前筛选下的会话明细；未知值留空，避免在表格里被当成 0。 */
export function usageCsv(rows: UsageSessionView[]): string {
  const lines = [CSV_HEADER.map(csvCell).join(',')]
  for (const row of rows) {
    lines.push(
      [
        USAGE_CLIENTS[row.client],
        formatDateTime(row.time),
        row.project,
        row.sessionId,
        row.model,
        row.requests,
        row.tokens.input,
        row.tokens.output,
        row.tokens.cacheRead,
        row.tokens.cacheWrite,
        row.tokens.reasoning,
        row.tokens.total,
        row.costUsd
      ]
        .map(csvCell)
        .join(',')
    )
  }
  return lines.join('\r\n')
}
