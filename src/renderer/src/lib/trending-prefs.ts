import { TRENDING_PERIODS, findTrendingLanguage } from '../../../shared/github-trending'
import type { TrendingLanguage, TrendingPeriod } from '../../../shared/github-trending'

export const TRENDING_REFRESH_INTERVALS = [
  { value: '0', label: '关闭' },
  { value: '5', label: '5 分钟' },
  { value: '10', label: '10 分钟' },
  { value: '30', label: '30 分钟' }
] as const

export type TrendingRefreshInterval = (typeof TRENDING_REFRESH_INTERVALS)[number]['value']

export interface TrendingPrefs {
  period: TrendingPeriod
  language: TrendingLanguage | ''
  refreshInterval: TrendingRefreshInterval
}

const PREFS_KEY = 'toolbox.github-trending.prefs.v1'

export const DEFAULT_TRENDING_PREFS: TrendingPrefs = {
  period: 'daily',
  language: '',
  refreshInterval: '10'
}

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    // 隐私模式或禁用本地存储：偏好不持久化不影响榜单。
    return null
  }
}

/** 读取失败一律回退默认值，避免损坏的偏好挡住页面。 */
export function loadTrendingPrefs(): TrendingPrefs {
  try {
    const raw = storage()?.getItem(PREFS_KEY)
    if (!raw) return DEFAULT_TRENDING_PREFS
    const data = JSON.parse(raw) as unknown
    if (!data || typeof data !== 'object' || Array.isArray(data)) return DEFAULT_TRENDING_PREFS
    const value = data as Record<string, unknown>
    const period = TRENDING_PERIODS.find((item) => item.value === value.period)?.value
    const language =
      typeof value.language === 'string' ? findTrendingLanguage(value.language) : null
    const refreshInterval = TRENDING_REFRESH_INTERVALS.find(
      (item) => item.value === value.refreshInterval
    )?.value
    return {
      period: period ?? DEFAULT_TRENDING_PREFS.period,
      language: language ?? '',
      refreshInterval: refreshInterval ?? DEFAULT_TRENDING_PREFS.refreshInterval
    }
  } catch {
    return DEFAULT_TRENDING_PREFS
  }
}

export function saveTrendingPrefs(prefs: TrendingPrefs): void {
  try {
    storage()?.setItem(PREFS_KEY, JSON.stringify(prefs))
  } catch {
    // 写入失败只影响下次打开时的默认筛选。
  }
}
