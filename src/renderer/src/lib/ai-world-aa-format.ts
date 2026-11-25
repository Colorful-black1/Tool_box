import { formatDate, formatPrice } from './ai-world-format'

export function formatAaIndex(value: number | null): string {
  return value == null ? '—' : value.toFixed(1)
}

export function formatAaVersion(version: number | null): string {
  if (version == null) return '版本未知'
  return Number.isInteger(version) ? `v${version}.0` : `v${version}`
}

export function formatAaCostPerTask(value: number | null): string {
  if (value == null) return '—'
  if (value < 0.01) return `$${value.toFixed(4)}`
  if (value < 1) return `$${value.toFixed(3)}`
  return `$${value.toFixed(2)}`
}

export function formatAaSpeed(value: number | null): string {
  return value == null ? '—' : `${Math.round(value)} tok/s`
}

export function formatAaLatency(value: number | null): string {
  return value == null ? '—' : `${value.toFixed(2)} 秒`
}

export function formatAaPrice(value: number | null): string {
  return value == null ? '—' : formatPrice(value)
}

export function formatAaDate(value: string | null): string {
  return value == null ? '—' : formatDate(value, 'day')
}

export function formatAaQuota(remaining: number | null): string | null {
  return remaining == null ? null : `本窗口剩余 ${remaining} 次`
}
