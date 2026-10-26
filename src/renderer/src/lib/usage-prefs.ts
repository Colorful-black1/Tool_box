import { USAGE_CLIENTS, USAGE_SORT_KEYS } from '../../../shared/agent-usage'
import type { UsageClient, UsageSortKey } from '../../../shared/agent-usage'

/** 统计页的周期预设；自定义日期保留用户手选的范围。 */
export const USAGE_PERIODS = [
  { value: 'today', label: '今日' },
  { value: 'week', label: '近 7 天' },
  { value: 'month', label: '本月' },
  { value: 'days30', label: '近 30 天' },
  { value: 'all', label: '累计' },
  { value: 'custom', label: '自定义日期' }
] as const
export type UsagePeriod = (typeof USAGE_PERIODS)[number]['value']

/** 自动刷新间隔，单位为秒；0 表示关闭。 */
export const USAGE_REFRESH_INTERVALS = [
  { value: '0', label: '关闭' },
  { value: '5', label: '5 秒' },
  { value: '10', label: '10 秒' },
  { value: '30', label: '30 秒' },
  { value: '60', label: '60 秒' }
] as const
export type UsageRefreshInterval = (typeof USAGE_REFRESH_INTERVALS)[number]['value']

export interface UsagePrefs {
  period: UsagePeriod
  refreshInterval?: UsageRefreshInterval
  client?: UsageClient
  project?: string
  model?: string
  from?: string
  to?: string
  sort?: UsageSortKey
  desc?: boolean
}

const PREFS_KEY = 'toolbox.agent-usage.prefs.v1'

export function localDateString(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

/** 含今天在内的最近 days 个自然日；周期筛选与趋势图共用同一套边界。 */
export function rollingRange(days: number, now = new Date()): { from: string; to: string } {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1))
  return { from: localDateString(start), to: localDateString(now) }
}

/** 周期换算成本地日历边界；累计与自定义不设边界。 */
export function periodRange(period: UsagePeriod, now = new Date()): { from?: string; to?: string } {
  switch (period) {
    case 'today':
      return { from: localDateString(now), to: localDateString(now) }
    case 'week':
      return rollingRange(7, now)
    case 'month':
      return {
        from: localDateString(new Date(now.getFullYear(), now.getMonth(), 1)),
        to: localDateString(now)
      }
    case 'days30':
      return rollingRange(30, now)
    case 'all':
    case 'custom':
      return {}
  }
}

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    // 隐私模式或禁用本地存储：偏好不持久化不影响统计。
    return null
  }
}

const isDay = (value: unknown): value is string =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)

/** 读取失败一律回退默认值，避免损坏的偏好挡住页面。 */
export function loadUsagePrefs(): UsagePrefs | null {
  try {
    const raw = storage()?.getItem(PREFS_KEY)
    if (!raw) return null
    const data = JSON.parse(raw) as unknown
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null
    const value = data as Record<string, unknown>
    const period = USAGE_PERIODS.find((item) => item.value === value.period)?.value ?? 'today'
    return {
      period,
      refreshInterval: USAGE_REFRESH_INTERVALS.find((item) => item.value === value.refreshInterval)
        ?.value,
      ...(typeof value.client === 'string' && Object.hasOwn(USAGE_CLIENTS, value.client)
        ? { client: value.client as UsageClient }
        : {}),
      ...(typeof value.project === 'string' && value.project.length <= 4096
        ? { project: value.project }
        : {}),
      ...(typeof value.model === 'string' && value.model.length <= 4096
        ? { model: value.model }
        : {}),
      ...(isDay(value.from) ? { from: value.from } : {}),
      ...(isDay(value.to) ? { to: value.to } : {}),
      ...(typeof value.sort === 'string' &&
      (USAGE_SORT_KEYS as readonly string[]).includes(value.sort)
        ? { sort: value.sort as UsageSortKey }
        : {}),
      ...(typeof value.desc === 'boolean' ? { desc: value.desc } : {})
    }
  } catch {
    return null
  }
}

export function saveUsagePrefs(prefs: UsagePrefs): void {
  try {
    storage()?.setItem(PREFS_KEY, JSON.stringify(prefs))
  } catch {
    // 写入失败只影响下次打开时的默认筛选。
  }
}
