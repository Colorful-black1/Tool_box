import type { AiAgentArenaMetricUnit } from '@shared/ai-agent-arena'
import { formatCount } from './ai-world-format'

export function formatAgentValue(value: number | null, unit: AiAgentArenaMetricUnit): string {
  if (value == null || !Number.isFinite(value)) return '—'
  if (unit === 'pct') return `${value.toFixed(value >= 100 ? 0 : 1)}%`
  if (unit === 'usd') {
    if (value < 0.01) return `$${value.toFixed(4)}`
    if (value < 1) return `$${value.toFixed(3)}`
    if (value < 10) return `$${value.toFixed(2)}`
    return `$${Math.round(value)}`
  }
  if (unit === 'tokens') return formatCount(Math.round(value))
  if (unit === 'seconds') {
    if (value < 60) return `${Math.round(value)} 秒`
    if (value < 3600) return `${Math.round(value / 60)} 分钟`
    return `${(value / 3600).toFixed(1)} 小时`
  }
  return value.toFixed(value >= 100 ? 1 : 2)
}

export function formatAgentDate(value: string | null): string {
  if (!value) return '—'
  return value.slice(0, 10)
}

export function formatRelativeTime(value: string | null): string {
  if (!value) return '未知'
  const time = Date.parse(value)
  if (!Number.isFinite(time)) return '未知'
  const seconds = Math.max(0, Math.round((Date.now() - time) / 1000))
  if (seconds < 60) return '刚刚'
  if (seconds < 3600) return `${Math.round(seconds / 60)} 分钟前`
  if (seconds < 86400) return `${Math.round(seconds / 3600)} 小时前`
  return `${Math.round(seconds / 86400)} 天前`
}

export function formatAgentDateTime(value: string | null): string {
  if (!value) return '未知'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('zh-CN', { hour12: false })
}
