import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AI_WORLD_AA_TTL_MS } from '../../../shared/ai-world-aa'
import type { FetchLike } from '../github-trending/fetch'
import { AiWorldAaService } from './service'

function model(id: string, name: string): Record<string, unknown> {
  return {
    id,
    name,
    slug: id,
    release_date: '2026-11-17',
    model_creator: { name: 'OpenAI' },
    evaluations: { artificial_analysis_intelligence_index: 60 },
    artificial_analysis_intelligence_index_cost: { cost_per_task: { total_cost: 2.5 } },
    pricing: { price_1m_input_tokens: 1, price_1m_output_tokens: 2 },
    performance_v3: {
      mean_output_tokens_per_second: 100,
      mean_time_to_first_token_seconds: 1,
      mean_time_to_first_answer_token_seconds: 2
    }
  }
}

function page(models: unknown[], hasMore: boolean): Response {
  return new Response(
    JSON.stringify({
      tier: 'free',
      intelligence_index_version: 5,
      pagination: { page: 1, page_size: 200, total_pages: 2, has_more: hasMore },
      data: models
    }),
    {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'x-ratelimit-remaining': hasMore ? '99' : '98',
        'x-ratelimit-reset': '1790000000'
      }
    }
  )
}

describe('Artificial Analysis 服务', () => {
  let dir: string
  let cacheFile: string
  let now: number
  let apiKey: string | null
  let fetchImpl: FetchLike
  let calls: string[]

  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'info').mockImplementation(() => {})
    dir = mkdtempSync(join(tmpdir(), 'toolbox-ai-world-aa-'))
    cacheFile = join(dir, 'cache.json')
    now = Date.UTC(2026, 10, 25)
    apiKey = 'test-key-12345678'
    calls = []
    fetchImpl = async (input) => {
      calls.push(input)
      const url = new URL(input)
      if (url.searchParams.get('page') === '1') return page([model('m1', 'Model One')], true)
      return page([model('m2', 'Model Two')], false)
    }
  })

  afterEach(() => {
    vi.restoreAllMocks()
    rmSync(dir, { recursive: true, force: true })
  })

  function service(): AiWorldAaService {
    return new AiWorldAaService({
      fetchImpl: (input, init) => fetchImpl(input, init),
      cacheFile,
      getApiKey: () => apiKey,
      now: () => now
    })
  }

  it('未配置 Key 时不发请求', async () => {
    apiKey = null
    const result = await service().get({ allowStale: true })
    expect(result.snapshot).toBeNull()
    expect(result.state.configured).toBe(false)
    expect(result.state.note).toContain('未配置')
    expect(calls).toHaveLength(0)
  })

  it('按 has_more 翻页合并模型并缓存', async () => {
    const result = await service().get()
    expect(result.source).toBe('network')
    expect(result.snapshot?.models.map((item) => item.id)).toEqual(['m1', 'm2'])
    expect(result.snapshot?.intelligenceIndexVersion).toBe(5)
    expect(result.state.quotaRemaining).toBe(98)
    expect(result.state.ok).toBe(true)
    expect(calls).toHaveLength(2)
    expect(JSON.parse(readFileSync(cacheFile, 'utf8'))).toMatchObject({ version: 1 })

    const cached = await service().get({ allowStale: true })
    expect(cached.source).toBe('cache')
    expect(calls).toHaveLength(2)
  })

  it('TTL 到期后刷新，失败时保留旧缓存', async () => {
    const first = service()
    await first.get()
    now += AI_WORLD_AA_TTL_MS + 1
    fetchImpl = async () => {
      throw new Error('synthetic-network-error')
    }
    const result = await first.get()
    expect(result.source).toBe('cache')
    expect(result.snapshot?.models).toHaveLength(2)
    expect(result.state.ok).toBe(false)
    expect(result.state.note).toContain('显示上次缓存')
  })

  it('401 返回可读的 Key 失效提示', async () => {
    fetchImpl = async () => new Response('{}', { status: 401 })
    const result = await service().get()
    expect(result.snapshot).toBeNull()
    expect(result.state.configured).toBe(true)
    expect(result.state.note).toContain('API Key 无效')
  })

  it('缺少配额响应头时返回 null，而不是 0', async () => {
    fetchImpl = async () =>
      new Response(
        JSON.stringify({
          tier: 'free',
          intelligence_index_version: 5,
          pagination: { page: 1, page_size: 200, total_pages: 1, has_more: false },
          data: [model('m1', 'Model One')]
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    const result = await service().get()
    expect(result.state.quotaRemaining).toBeNull()
    expect(result.state.quotaResetAt).toBeNull()
  })

  it('429 带 Retry-After 时给出可读提示', async () => {
    fetchImpl = async () =>
      new Response('{}', { status: 429, headers: { 'retry-after': '120' } })
    const result = await service().get()
    expect(result.state.note).toContain('额度已用完')
    expect(result.state.note).toContain('2 分钟')
  })

  it('手动刷新受 5 分钟冷却限制', async () => {
    const first = service()
    await first.get()
    const result = await first.get({ force: true })
    expect(result.source).toBe('cache')
    expect(result.state.note).toContain('刷新过于频繁')
    expect(calls).toHaveLength(2)
  })
})
