import { describe, expect, it, vi } from 'vitest'

import { fetchSearchFallback } from './search-fallback'
import type { FetchLike } from './fetch'

const NOW = Date.UTC(2026, 10, 11, 12)

describe('GitHub Search 兜底', () => {
  it('按窗口、星数门槛和语言生成查询', async () => {
    const captured: string[] = []
    const fetchImpl = vi.fn(async (input: string) => {
      captured.push(input)
      return new Response(
        JSON.stringify({
          items: [
            {
              full_name: 'new/project',
              html_url: 'https://github.com/new/project',
              description: 'A new project',
              language: 'TypeScript',
              stargazers_count: 123,
              forks_count: 7
            }
          ]
        }),
        { status: 200 }
      )
    })

    const items = await fetchSearchFallback(
      fetchImpl as unknown as FetchLike,
      'weekly',
      'typescript',
      NOW
    )

    const decoded = decodeURIComponent(captured[0])
    expect(decoded).toContain('created:>=2026-11-04')
    expect(decoded).toContain('stars:>=30')
    expect(decoded).toContain('language:TypeScript')
    expect(items[0]).toMatchObject({
      fullName: 'new/project',
      stars: 123,
      forks: 7,
      periodStars: null
    })
  })

  it('带空格的语言加引号，避免被拆成两个词', async () => {
    let captured = ''
    const fetchImpl = vi.fn(async (input: string) => {
      captured = input
      return new Response(JSON.stringify({ items: [] }), { status: 200 })
    })

    await fetchSearchFallback(fetchImpl as unknown as FetchLike, 'monthly', 'jupyter-notebook', NOW)
    expect(decodeURIComponent(captured)).toContain('language:"Jupyter Notebook"')
    expect(decodeURIComponent(captured)).toContain('created:>=2026-10-12')
  })

  it('403 / 429 转成限流文案', async () => {
    const fetchImpl = vi.fn(async () => new Response('rate limited', { status: 403 }))
    await expect(
      fetchSearchFallback(fetchImpl as unknown as FetchLike, 'daily', null, NOW)
    ).rejects.toThrow('频繁')
  })
})
