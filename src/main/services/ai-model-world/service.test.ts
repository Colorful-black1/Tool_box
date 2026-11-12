import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AI_WORLD_CACHE_TTL_MS } from '../../../shared/ai-model-world'
import { AiWorldService } from './service'

function snapshot(): Record<string, unknown> {
  return {
    generatedAt: '2026-06-01T00:00:00.000Z',
    sources: {
      'models.dev': { ok: true, fetchedAt: '2026-06-01T00:00:00.000Z' },
      'epoch.ai': { ok: true, fetchedAt: '2026-06-01T00:00:00.000Z' }
    },
    vendors: [{ id: 'v1', name: 'Vendor', nameZh: '厂商', continent: 'east', homepage: null }],
    models: [
      {
        id: 'v1/model',
        slug: 'v1-model',
        name: 'Model',
        vendorId: 'v1',
        releaseDate: '2026-05-01',
        releaseDatePrecision: 'day',
        knowledgeCutoff: null,
        retiredAt: null,
        contextWindow: 128000,
        maxOutput: 8192,
        pricing: { inputPerMTok: 1, outputPerMTok: 2, cachedInputPerMTok: null },
        modalities: { input: ['text'], output: ['text'] },
        capabilities: {
          toolCall: null,
          reasoning: null,
          structuredOutput: null,
          promptCaching: null
        },
        openWeights: false,
        license: null,
        params: { totalB: null, activeB: null, confidence: 'unknown' },
        benchmarks: {
          eci: 100,
          swe_bench_verified: null,
          swe_bench_vendor: null,
          swe_bench_pro: null,
          aime: null,
          gpqa_diamond: null,
          arc_agi_2: null,
          fiction_live: null,
          webdev_arena_elo: null
        },
        coding: [],
        scores: [
          {
            league: 'eci',
            score: 100,
            unit: 'index',
            attribution: 'third-party',
            source: 'epoch.ai',
            sourceUrl: 'https://example.com/score'
          }
        ],
        provenance: {},
        firstSeenAt: '2026-05-01'
      }
    ],
    benchmarks: []
  }
}

describe('AI 模型世界服务', () => {
  let dir: string
  let cacheFile: string

  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'info').mockImplementation(() => {})
    dir = mkdtempSync(join(tmpdir(), 'toolbox-ai-world-'))
    cacheFile = join(dir, 'cache.json')
  })

  afterEach(() => {
    vi.restoreAllMocks()
    rmSync(dir, { recursive: true, force: true })
  })

  it('成功采集并写缓存，allowStale 不再次请求网络', async () => {
    let now = 1_000
    const collect = vi.fn(async () => snapshot() as never)
    const service = new AiWorldService({ cacheFile, collect, now: () => now })

    await expect(service.get({ force: true })).resolves.toMatchObject({
      source: 'network',
      stale: false
    })
    expect(collect).toHaveBeenCalledTimes(1)
    expect(JSON.parse(readFileSync(cacheFile, 'utf8'))).toMatchObject({ version: 2 })

    now += 1_000
    await expect(service.get({ allowStale: true })).resolves.toMatchObject({
      source: 'cache',
      stale: false
    })
    expect(collect).toHaveBeenCalledTimes(1)
  })

  it('缓存过期后重新采集，失败时保留旧缓存', async () => {
    let now = 1_000
    const collect = vi.fn(async () => snapshot() as never)
    const service = new AiWorldService({ cacheFile, collect, now: () => now })
    await service.get({ force: true })

    now += AI_WORLD_CACHE_TTL_MS + 1
    collect.mockRejectedValue(new Error('synthetic-network-error'))
    await expect(service.get()).resolves.toMatchObject({
      source: 'cache',
      stale: true
    })
    expect(collect).toHaveBeenCalledTimes(2)
  })

  it('没有缓存且采集失败时抛出可读错误，不伪造数据', async () => {
    const collect = vi.fn(async () => {
      throw new Error('synthetic-private-detail')
    })
    const service = new AiWorldService({ cacheFile, collect })

    await expect(service.get()).rejects.toMatchObject({
      message: 'AI 模型数据读取失败，请检查网络或代理后重试'
    })
  })

  it('损坏缓存不影响重新采集', async () => {
    writeFileSync(cacheFile, '{"version":1,"models":[]}', 'utf8')
    const collect = vi.fn(async () => snapshot() as never)
    const service = new AiWorldService({ cacheFile, collect })

    await expect(service.get()).resolves.toMatchObject({ source: 'network' })
    expect(collect).toHaveBeenCalledTimes(1)
  })

  it('只允许打开当前来源白名单中的链接，并复用并发查询', async () => {
    let resolve!: (value: unknown) => void
    const collect = vi.fn(
      () =>
        new Promise((done) => {
          resolve = done
        })
    ) as unknown as () => Promise<never>
    const service = new AiWorldService({ cacheFile, collect })

    const first = service.get({ force: true })
    const second = service.get({ force: true })
    resolve(snapshot())
    await expect(Promise.all([first, second])).resolves.toHaveLength(2)
    expect(collect).toHaveBeenCalledTimes(1)
    expect(service.isKnownSource('https://example.com/score')).toBe(true)
    expect(service.isKnownSource('https://models.dev')).toBe(true)
    expect(service.isKnownSource('https://example.com/other')).toBe(false)
  })
})
