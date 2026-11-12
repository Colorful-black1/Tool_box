/** GitHub 热门榜单的共享契约：渲染层、preload、主进程共用同一份枚举与视图类型。 */

export const TRENDING_PERIODS = [
  { value: 'daily', label: '今日', gainLabel: '今日', days: 1 },
  { value: 'weekly', label: '本周', gainLabel: '本周', days: 7 },
  { value: 'monthly', label: '本月', gainLabel: '本月', days: 30 }
] as const

export type TrendingPeriod = (typeof TRENDING_PERIODS)[number]['value']

export const TRENDING_PERIOD_VALUES = TRENDING_PERIODS.map(
  (item) => item.value
) as readonly TrendingPeriod[]

/**
 * 语言筛选白名单。
 *
 * path 是 github.com/trending 的路径片段（C++ / C# 已预编码），search 是
 * GitHub Search API 的 language: 值；两者不能直接互转，所以显式维护。
 */
export const TRENDING_LANGUAGES = [
  { value: '', label: '全部语言', path: '', search: '' },
  { value: 'typescript', label: 'TypeScript', path: 'typescript', search: 'TypeScript' },
  { value: 'javascript', label: 'JavaScript', path: 'javascript', search: 'JavaScript' },
  { value: 'python', label: 'Python', path: 'python', search: 'Python' },
  { value: 'go', label: 'Go', path: 'go', search: 'Go' },
  { value: 'rust', label: 'Rust', path: 'rust', search: 'Rust' },
  { value: 'java', label: 'Java', path: 'java', search: 'Java' },
  { value: 'c++', label: 'C++', path: 'c%2B%2B', search: 'C++' },
  { value: 'c#', label: 'C#', path: 'c%23', search: 'C#' },
  { value: 'php', label: 'PHP', path: 'php', search: 'PHP' },
  { value: 'ruby', label: 'Ruby', path: 'ruby', search: 'Ruby' },
  { value: 'swift', label: 'Swift', path: 'swift', search: 'Swift' },
  { value: 'kotlin', label: 'Kotlin', path: 'kotlin', search: 'Kotlin' },
  { value: 'shell', label: 'Shell', path: 'shell', search: 'Shell' },
  {
    value: 'jupyter-notebook',
    label: 'Jupyter Notebook',
    path: 'jupyter-notebook',
    search: 'Jupyter Notebook'
  }
] as const

export type TrendingLanguage = Exclude<(typeof TRENDING_LANGUAGES)[number]['value'], ''>

export const TRENDING_LANGUAGE_VALUES = TRENDING_LANGUAGES.map((item) => item.value).filter(
  (value): value is TrendingLanguage => value !== ''
)

export type TrendingSource = 'trending' | 'search'

/** 一条榜单记录；数字统一由解析器转成 number，渲染层不再做二次解析。 */
export interface TrendingRepo {
  /** 页面原始顺序，从 1 开始；筛选后仍保留原排名 */
  rank: number
  /** owner/repo */
  fullName: string
  url: string
  description: string
  language: string
  /** 已校验为 #rgb / #rrggbb；无语言时为 null */
  languageColor: string | null
  stars: number
  forks: number
  /** 本期新增 Star；Search 兜底时为 null，不能显示成 0 */
  periodStars: number | null
}

export interface TrendingResult {
  period: TrendingPeriod
  /** null 表示全部语言 */
  language: TrendingLanguage | null
  source: TrendingSource
  items: TrendingRepo[]
  fetchedAtMs: number
  /** 数据已超过 TTL；只用于首屏占位，不代表请求失败 */
  stale: boolean
  /** 请求失败后回退旧缓存时的用户提示；成功或纯缓存读取时为 null */
  warning: string | null
}

export interface TrendingQuery {
  period: TrendingPeriod
  language?: TrendingLanguage
  /** 手动刷新：绕过 TTL，但仍复用同 key 的进行中请求 */
  force?: boolean
  /** 只读缓存、不发起网络请求；没有缓存时返回 null */
  allowStale?: boolean
}

/** 内存缓存 TTL：首屏与自动刷新都用它判断是否需要联网。 */
export const TRENDING_CACHE_TTL_MS = 10 * 60_000

/** 磁盘缓存最多保留 7 天，过期后即使断网也不再展示。 */
export const TRENDING_DISK_TTL_MS = 7 * 24 * 60 * 60_000

/** 单次最多展示条数；GitHub 实际通常返回 10–20 条。 */
export const TRENDING_MAX_ITEMS = 50

/** 简介截断长度，避免异常页面把一行撑得过高。 */
export const TRENDING_MAX_DESCRIPTION = 300

export function findTrendingPeriod(value: unknown): (typeof TRENDING_PERIODS)[number] | null {
  return TRENDING_PERIODS.find((item) => item.value === value) ?? null
}

export function findTrendingLanguage(value: unknown): TrendingLanguage | null {
  const entry = TRENDING_LANGUAGES.find((item) => item.value === value)
  if (!entry || entry.value === '') return null
  return entry.value
}

export function trendingLanguagePath(language: TrendingLanguage | null): string {
  if (!language) return ''
  return TRENDING_LANGUAGES.find((item) => item.value === language)?.path ?? ''
}

export function trendingLanguageSearch(language: TrendingLanguage | null): string {
  if (!language) return ''
  return TRENDING_LANGUAGES.find((item) => item.value === language)?.search ?? ''
}
