import {
  TRENDING_MAX_ITEMS,
  findTrendingPeriod,
  trendingLanguageSearch
} from '../../../shared/github-trending'
import type {
  TrendingLanguage,
  TrendingPeriod,
  TrendingRepo
} from '../../../shared/github-trending'
import { TrendingError } from './fetch'
import type { FetchLike } from './fetch'

const SEARCH_TIMEOUT_MS = 12_000

/** 不同窗口用不同星数门槛，避免 Search 兜底全是刚建的空仓库。 */
const STAR_THRESHOLDS: Record<TrendingPeriod, number> = {
  daily: 5,
  weekly: 30,
  monthly: 50
}

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 ToolBox/0.3.0'

/**
 * 官方 Search API 兜底。
 *
 * 口径与 Trending 不同：只按「窗口内新建 + 总 Star」找近期项目，
 * 因此返回项的 periodStars 必须是 null，界面不能显示成 0 或「今日新增」。
 */
export async function fetchSearchFallback(
  fetchImpl: FetchLike,
  period: TrendingPeriod,
  language: TrendingLanguage | null,
  now: number
): Promise<TrendingRepo[]> {
  const info = findTrendingPeriod(period)
  if (!info) throw new TrendingError('榜单周期无效')

  const since = new Date(now - info.days * 24 * 60 * 60_000).toISOString().slice(0, 10)
  const terms = [`created:>=${since}`, `stars:>=${STAR_THRESHOLDS[period]}`]
  const languageTerm = trendingLanguageSearch(language)
  if (languageTerm) terms.push(`language:${quoteSearch(languageTerm)}`)

  const url =
    'https://api.github.com/search/repositories' +
    `?q=${encodeURIComponent(terms.join(' '))}` +
    '&sort=stars&order=desc&per_page=25'

  let response: Response
  try {
    response = await fetchImpl(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': USER_AGENT
      },
      signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS)
    })
  } catch (error) {
    throw new TrendingError(
      error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')
        ? '连接 GitHub 搜索接口超时，请稍后重试'
        : '无法连接 GitHub 搜索接口，请检查网络后重试',
      { cause: error }
    )
  }

  if (!response.ok) {
    if (response.status === 403 || response.status === 429) {
      throw new TrendingError('GitHub 接口请求过于频繁，请稍后再试')
    }
    throw new TrendingError(`GitHub 搜索接口暂时不可用（HTTP ${response.status}）`)
  }

  let payload: unknown
  try {
    payload = await response.json()
  } catch (error) {
    throw new TrendingError('GitHub 搜索接口返回了异常内容', { cause: error })
  }
  if (!isObject(payload) || !Array.isArray(payload.items)) {
    throw new TrendingError('GitHub 搜索接口返回格式异常')
  }

  const items: TrendingRepo[] = []
  for (const [index, raw] of payload.items.entries()) {
    const repo = searchItem(raw, index + 1)
    if (repo) items.push(repo)
    if (items.length >= TRENDING_MAX_ITEMS) break
  }
  return items
}

function searchItem(value: unknown, rank: number): TrendingRepo | null {
  if (!isObject(value)) return null
  const fullName = typeof value.full_name === 'string' ? value.full_name : ''
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(fullName)) return null
  if (typeof value.stargazers_count !== 'number' || !Number.isFinite(value.stargazers_count))
    return null
  const forks = typeof value.forks_count === 'number' ? value.forks_count : 0
  const htmlUrl =
    typeof value.html_url === 'string' && value.html_url.startsWith('https://github.com/')
      ? value.html_url
      : `https://github.com/${fullName}`
  return {
    rank,
    fullName,
    url: htmlUrl,
    description: typeof value.description === 'string' ? value.description : '',
    language: typeof value.language === 'string' ? value.language : '',
    languageColor: null,
    stars: value.stargazers_count,
    forks,
    periodStars: null
  }
}

function quoteSearch(value: string): string {
  return /^[A-Za-z0-9-]+$/.test(value) ? value : `"${value.replace(/"/g, '')}"`
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
