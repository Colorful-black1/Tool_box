import { TRENDING_CACHE_TTL_MS, trendingLanguagePath } from '../../../shared/github-trending'
import type {
  TrendingLanguage,
  TrendingPeriod,
  TrendingQuery,
  TrendingResult
} from '../../../shared/github-trending'
import { TrendingCache, trendingCacheKey } from './cache'
import type { TrendingCacheEntry } from './cache'
import { TrendingError, describeTrendingError } from './fetch'
import type { FetchLike } from './fetch'
import { parseTrendingHtml, TrendingParseError } from './parse'
import { fetchSearchFallback } from './search-fallback'

const HTML_TIMEOUT_MS = 12_000
const RETRY_DELAY_MS = 800
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 ToolBox/0.3.0'

export interface GithubTrendingServiceOptions {
  fetchImpl?: FetchLike
  /** 不传表示只在内存缓存；主进程会传入 userData 下的 JSON 路径。 */
  cacheFile?: string | null
  now?: () => number
}

interface PrimaryResult {
  items: TrendingResult['items']
}

/**
 * 热榜服务：Trending 页面优先，Search API 兜底，内存 / 磁盘缓存收尾。
 *
 * IPC 是请求 / 响应，没有推送，因此 allowStale 只负责快速读缓存；
 * 渲染层拿到缓存后再显式 force 一次，避免在服务里做后台刷新和事件通道。
 */
export class GithubTrendingService {
  private readonly fetchImpl: FetchLike
  private readonly cache: TrendingCache
  private readonly now: () => number
  private readonly pending = new Map<string, Promise<TrendingResult>>()

  constructor(options: GithubTrendingServiceOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? ((input, init) => globalThis.fetch(input, init))
    this.now = options.now ?? Date.now
    this.cache = new TrendingCache(options.cacheFile ?? null, this.now)
  }

  async list(query: TrendingQuery): Promise<TrendingResult | null> {
    const language = query.language ?? null
    const key = trendingCacheKey(query.period, language)

    if (query.allowStale) {
      const entry = await this.cache.get(key)
      return entry ? this.resultOf(entry, this.isStale(entry), null) : null
    }

    const active = this.pending.get(key)
    if (active) return active

    const run = this.load(query.period, language, key, query.force === true)
    this.pending.set(key, run)
    try {
      return await run
    } finally {
      if (this.pending.get(key) === run) this.pending.delete(key)
    }
  }

  private async load(
    period: TrendingPeriod,
    language: TrendingLanguage | null,
    key: string,
    force: boolean
  ): Promise<TrendingResult> {
    const startedAt = this.now()
    const cached = await this.cache.get(key)
    if (cached && !force && !this.isStale(cached)) return this.resultOf(cached, false, null)

    const now = this.now()
    try {
      const items = await this.fetchTrending(period, language)
      const result: TrendingResult = {
        period,
        language,
        source: 'trending',
        items,
        fetchedAtMs: now,
        stale: false,
        warning: null
      }
      await this.cache.set({
        period,
        language,
        source: 'trending',
        items,
        fetchedAtMs: now
      })
      console.info('[GithubTrending] 榜单更新', {
        period,
        language,
        source: result.source,
        count: items.length,
        durationMs: this.now() - startedAt
      })
      return result
    } catch (primaryError) {
      console.warn('[GithubTrending] Trending 失败，改用搜索兜底', {
        period,
        language,
        error: describeTrendingError(primaryError)
      })
      try {
        const items = await fetchSearchFallback(this.fetchImpl, period, language, now)
        if (items.length === 0) throw new TrendingError('GitHub 暂时没有返回可展示的项目')
        const result: TrendingResult = {
          period,
          language,
          source: 'search',
          items,
          fetchedAtMs: this.now(),
          stale: false,
          warning: 'GitHub Trending 暂不可用，已切换为搜索兜底；本期新增 Star 不适用'
        }
        await this.cache.set({
          period,
          language,
          source: 'search',
          items,
          fetchedAtMs: result.fetchedAtMs
        })
        console.info('[GithubTrending] 榜单更新（搜索兜底）', {
          period,
          language,
          count: items.length,
          durationMs: this.now() - startedAt
        })
        return result
      } catch (fallbackError) {
        if (cached) {
          console.warn('[GithubTrending] 主源与兜底均失败，返回缓存', {
            period,
            language,
            error: describeTrendingError(fallbackError)
          })
          return this.resultOf(cached, true, '网络请求失败，正在显示上次缓存')
        }
        throw new TrendingError(describeTrendingError(fallbackError), {
          cause: fallbackError
        })
      }
    }
  }

  private async fetchTrending(
    period: TrendingPeriod,
    language: TrendingLanguage | null
  ): Promise<PrimaryResult['items']> {
    const path = trendingLanguagePath(language)
    const url = `https://github.com/trending${path ? `/${path}` : ''}?since=${period}`
    const response = await this.request(url, {
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
        'User-Agent': USER_AGENT
      }
    })

    if (!response.ok) {
      if (response.status === 403 || response.status === 429)
        throw new TrendingError('GitHub 页面请求过于频繁，请稍后再试')
      throw new TrendingError(`GitHub 页面暂时不可用（HTTP ${response.status}）`)
    }
    // net.fetch 文档说明返回对象的 url 不可靠，且请求地址固定为 github.com；
    // 这里不依赖 response.url 做重定向校验，避免把正常页面误判成未知站点。
    let html: string
    try {
      html = await response.text()
    } catch (error) {
      throw new TrendingError('读取 GitHub 页面失败，请稍后重试', { cause: error })
    }
    try {
      return parseTrendingHtml(html, period)
    } catch (error) {
      if (error instanceof TrendingParseError) {
        throw new TrendingError('GitHub 页面结构可能已变化，已尝试搜索兜底', { cause: error })
      }
      throw error
    }
  }

  /** 5xx 重试一次；4xx、超时和网络错误不重试，避免用户连续等两次超时。 */
  private async request(url: string, init: RequestInit): Promise<Response> {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await this.fetchImpl(url, {
          ...init,
          signal: AbortSignal.timeout(HTML_TIMEOUT_MS)
        })
        if (attempt === 0 && response.status >= 500) {
          await delay(RETRY_DELAY_MS)
          continue
        }
        return response
      } catch (error) {
        throw new TrendingError(describeTrendingError(error), { cause: error })
      }
    }
    throw new TrendingError('GitHub 页面暂时不可用，请稍后重试')
  }

  private isStale(entry: TrendingCacheEntry): boolean {
    return this.now() - entry.fetchedAtMs > TRENDING_CACHE_TTL_MS
  }

  private resultOf(
    entry: TrendingCacheEntry,
    stale: boolean,
    warning: string | null
  ): TrendingResult {
    return {
      period: entry.period,
      language: entry.language,
      source: entry.source,
      items: entry.items,
      fetchedAtMs: entry.fetchedAtMs,
      stale,
      warning
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
