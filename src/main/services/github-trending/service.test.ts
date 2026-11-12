import { describe, expect, it, vi } from 'vitest'

import { TRENDING_CACHE_TTL_MS } from '../../../shared/github-trending'
import { GithubTrendingService } from './service'
import type { FetchLike } from './fetch'

function page(repo = 'meta/astryx'): string {
  return `
<html><body>
<article class="Box-row">
  <h2><a href="/${repo}">meta / astryx</a></h2>
  <p class="col-9 color-fg-muted">An open source design system</p>
  <span class="repo-language-color" style="background-color: #3178c6"></span>
  <span itemprop="programmingLanguage">TypeScript</span>
  <a href="/${repo}/stargazers"><svg></svg>24,410</a>
  <a href="/${repo}/forks"><svg></svg>1,906</a>
  <span>2,842 stars today</span>
</article>
</body></html>`
}

function searchPayload(): Response {
  return new Response(
    JSON.stringify({
      items: [
        {
          full_name: 'new/project',
          html_url: 'https://github.com/new/project',
          description: 'A new project',
          language: 'Go',
          stargazers_count: 123,
          forks_count: 4
        }
      ]
    }),
    { status: 200, headers: { 'content-type': 'application/json' } }
  )
}

describe('GitHub 热榜服务', () => {
  it('主源成功时返回 trending，并写入缓存', async () => {
    const fetchImpl = vi.fn(async () => new Response(page(), { status: 200 }))
    const service = new GithubTrendingService({
      fetchImpl: fetchImpl as unknown as FetchLike,
      cacheFile: null,
      now: () => 1_000
    })

    const result = await service.list({ period: 'daily' })
    expect(result).toMatchObject({ source: 'trending', stale: false, warning: null })
    expect(result?.items[0]).toMatchObject({
      fullName: 'meta/astryx',
      stars: 24_410,
      periodStars: 2_842
    })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('同一 key 在 TTL 内复用缓存，force 才重新请求', async () => {
    let now = 1_000
    const fetchImpl = vi.fn(async () => new Response(page(), { status: 200 }))
    const service = new GithubTrendingService({
      fetchImpl: fetchImpl as unknown as FetchLike,
      cacheFile: null,
      now: () => now
    })

    await service.list({ period: 'daily' })
    await service.list({ period: 'daily' })
    expect(fetchImpl).toHaveBeenCalledTimes(1)

    now += TRENDING_CACHE_TTL_MS + 1
    await service.list({ period: 'daily', force: true })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('allowStale 只读缓存，不发起网络请求', async () => {
    let now = 1_000
    const fetchImpl = vi.fn(async () => new Response(page(), { status: 200 }))
    const service = new GithubTrendingService({
      fetchImpl: fetchImpl as unknown as FetchLike,
      cacheFile: null,
      now: () => now
    })

    expect(await service.list({ period: 'daily', allowStale: true })).toBeNull()
    await service.list({ period: 'daily' })
    now += TRENDING_CACHE_TTL_MS + 1

    const cached = await service.list({ period: 'daily', allowStale: true })
    expect(cached?.stale).toBe(true)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('主源 0 条时回退 Search，并清空本期新增', async () => {
    const fetchImpl = vi.fn(async (input: string) => {
      if (input.includes('api.github.com')) return searchPayload()
      return new Response('<html><body>no rows</body></html>', { status: 200 })
    })
    const service = new GithubTrendingService({
      fetchImpl: fetchImpl as unknown as FetchLike,
      cacheFile: null,
      now: () => 1_000
    })

    const result = await service.list({ period: 'weekly' })
    expect(result?.source).toBe('search')
    expect(result?.warning).toContain('搜索兜底')
    expect(result?.items[0].periodStars).toBeNull()
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('主源与兜底都失败时返回旧缓存并标记 stale', async () => {
    let now = 1_000
    let fail = false
    const fetchImpl = vi.fn(async () => {
      if (fail) return new Response('down', { status: 500 })
      return new Response(page(), { status: 200 })
    })
    const service = new GithubTrendingService({
      fetchImpl: fetchImpl as unknown as FetchLike,
      cacheFile: null,
      now: () => now
    })

    await service.list({ period: 'daily' })
    now += TRENDING_CACHE_TTL_MS + 1
    fail = true

    const result = await service.list({ period: 'daily', force: true })
    expect(result?.stale).toBe(true)
    expect(result?.warning).toContain('上次缓存')
    expect(result?.items[0].fullName).toBe('meta/astryx')
  })

  it('双失败且没有缓存时抛用户可读错误', async () => {
    const fetchImpl = vi.fn(async () => new Response('down', { status: 500 }))
    const service = new GithubTrendingService({
      fetchImpl: fetchImpl as unknown as FetchLike,
      cacheFile: null,
      now: () => 1_000
    })

    await expect(service.list({ period: 'daily' })).rejects.toThrow('GitHub')
  })

  it('并发请求共用一次抓取', async () => {
    const control: { resolve: ((response: Response) => void) | null } = { resolve: null }
    const fetchImpl = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          control.resolve = resolve
        })
    )
    const service = new GithubTrendingService({
      fetchImpl: fetchImpl as unknown as FetchLike,
      cacheFile: null,
      now: () => 1_000
    })

    const first = service.list({ period: 'daily' })
    const second = service.list({ period: 'daily' })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    control.resolve?.(new Response(page(), { status: 200 }))
    await Promise.all([first, second])
  })
})
