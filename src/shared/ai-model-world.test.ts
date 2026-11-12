import { describe, expect, it } from 'vitest'

import type {
  AiWorldBenchmarkScore,
  AiWorldModel,
  AiWorldSnapshot,
  AiWorldVendor
} from './ai-model-world'
import { aiWorldKindOf, createAiWorldIndex } from './ai-model-world'

function score(
  league: string,
  value: number,
  attribution: AiWorldBenchmarkScore['attribution'] = 'third-party'
): AiWorldBenchmarkScore {
  return { league, score: value, unit: 'pct', attribution, source: 'epoch.ai', sourceUrl: null }
}

function model(id: string, overrides: Partial<AiWorldModel> = {}): AiWorldModel {
  return {
    id,
    slug: id,
    name: id,
    vendorId: 'v1',
    releaseDate: '2026-01-01',
    releaseDatePrecision: 'day',
    knowledgeCutoff: null,
    retiredAt: null,
    contextWindow: 128_000,
    maxOutput: null,
    pricing: { inputPerMTok: 1, outputPerMTok: 2, cachedInputPerMTok: null },
    modalities: { input: ['text'], output: ['text'] },
    capabilities: { toolCall: null, reasoning: null, structuredOutput: null, promptCaching: null },
    openWeights: false,
    license: null,
    params: { totalB: null, activeB: null, confidence: 'unknown' },
    benchmarks: {
      eci: null,
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
    provenance: {},
    firstSeenAt: '2026-01-01',
    ...overrides
  }
}

function vendor(id: string, continent: 'east' | 'west'): AiWorldVendor {
  return {
    id,
    name: id,
    nameZh: id,
    country: continent === 'east' ? 'CN' : 'US',
    continent,
    motif: 'wanderer',
    accentColor: '#7c8da6',
    homepage: null
  }
}

function snapshot(
  models: AiWorldModel[],
  vendors: AiWorldVendor[] = [vendor('v1', 'west')]
): AiWorldSnapshot {
  return {
    generatedAt: '2026-06-01T00:00:00.000Z',
    sources: { 'epoch.ai': { ok: true, fetchedAt: '2026-06-01T00:00:00.000Z' } },
    vendors,
    models,
    benchmarks: []
  }
}

const codingLeagues = ['swe_bench_verified', 'terminal_bench_2_0', 'cursorbench']

describe('AI 模型世界派生逻辑', () => {
  it('今日格局从全体模型计算，缺失 ECI 的模型不参与聪明 / 最便宜等分位', () => {
    const models = [
      model('alpha', {
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
        contextWindow: 1_000_000,
        pricing: { inputPerMTok: 1, outputPerMTok: 10, cachedInputPerMTok: null },
        openWeights: true,
        coding: codingLeagues.map((league) => score(league, 90))
      }),
      model('beta', {
        benchmarks: {
          eci: 90,
          swe_bench_verified: null,
          swe_bench_vendor: null,
          swe_bench_pro: null,
          aime: null,
          gpqa_diamond: null,
          arc_agi_2: null,
          fiction_live: null,
          webdev_arena_elo: null
        },
        contextWindow: 128_000,
        pricing: { inputPerMTok: 0.1, outputPerMTok: 1, cachedInputPerMTok: null },
        coding: codingLeagues.map((league) => score(league, 70))
      }),
      model('gamma', {
        contextWindow: null,
        pricing: { inputPerMTok: 0, outputPerMTok: 0.1, cachedInputPerMTok: null },
        coding: codingLeagues.map((league) => score(league, 60))
      }),
      model('delta', {
        vendorId: 'v2',
        benchmarks: {
          eci: 80,
          swe_bench_verified: null,
          swe_bench_vendor: null,
          swe_bench_pro: null,
          aime: null,
          gpqa_diamond: null,
          arc_agi_2: null,
          fiction_live: null,
          webdev_arena_elo: null
        },
        contextWindow: 200_000,
        openWeights: true,
        releaseDate: '2026-05-01',
        coding: codingLeagues.map((league) => score(league, 50))
      }),
      model('epsilon', {
        benchmarks: {
          eci: 70,
          swe_bench_verified: null,
          swe_bench_vendor: null,
          swe_bench_pro: null,
          aime: null,
          gpqa_diamond: null,
          arc_agi_2: null,
          fiction_live: null,
          webdev_arena_elo: null
        },
        contextWindow: 2_000_000,
        releaseDate: '2026-05-20',
        coding: codingLeagues.map((league) => score(league, 40))
      })
    ]
    const index = createAiWorldIndex(snapshot(models, [vendor('v1', 'east'), vendor('v2', 'west')]))
    const byKey = Object.fromEntries(
      index.champions.map((champion) => [champion.key, champion.model.id])
    )

    expect(byKey.smart).toBe('alpha')
    expect(byKey.code).toBe('alpha')
    expect(byKey.east).toBe('alpha')
    expect(byKey.open).toBe('alpha')
    expect(byKey.memory).toBe('epsilon')
    expect(byKey.newest).toBe('epsilon')
    expect(byKey.cheap).toBe('beta')
    expect(index.metricsOf(models[2]).eci).toBeNull()
    expect(index.metricsOf(models[2]).rank).toBeNull()
    expect(index.metricsOf(models[2]).eciPercentile).toBeNull()
  })

  it('模型类型只看模态，编程共识只取第三方赛制', () => {
    expect(
      aiWorldKindOf(model('vision', { modalities: { input: ['text', 'image'], output: ['text'] } }))
    ).toBe('vision')
    expect(
      aiWorldKindOf(model('image', { modalities: { input: ['text'], output: ['image'] } }))
    ).toBe('image')
    expect(
      aiWorldKindOf(model('video', { modalities: { input: ['text'], output: ['video'] } }))
    ).toBe('video')
    expect(
      aiWorldKindOf(model('audio', { modalities: { input: ['text'], output: ['audio'] } }))
    ).toBe('audio')
    expect(
      aiWorldKindOf(model('omni', { modalities: { input: ['text', 'audio'], output: ['text'] } }))
    ).toBe('omni')

    const models = Array.from({ length: 5 }, (_, index) =>
      model(`m${index}`, {
        coding: [
          ...codingLeagues.map((league) => score(league, 50 + index)),
          score('vendor_only', 100, 'vendor-self-reported')
        ]
      })
    )
    const index = createAiWorldIndex(snapshot(models))
    expect(index.metricsOf(models[0]).code).toMatchObject({ leagues: 3 })
    expect(index.metricsOf(models[0]).code?.leagueIds).not.toContain('vendor_only')
  })

  it('没有 scores 时从 coding 和固定字段合成逐项成绩，并按赛制去重', () => {
    const m = model('fallback', {
      benchmarks: {
        eci: 120,
        swe_bench_verified: 70,
        swe_bench_vendor: null,
        swe_bench_pro: null,
        aime: 90,
        gpqa_diamond: null,
        arc_agi_2: null,
        fiction_live: null,
        webdev_arena_elo: null
      },
      coding: [score('cursorbench', 60), score('cursorbench', 60)]
    })
    const index = createAiWorldIndex(snapshot([m]))
    expect(index.scoresOf(m).filter((item) => item.league === 'cursorbench')).toHaveLength(1)
    expect(index.scoresOf(m).map((item) => item.league)).toEqual(
      expect.arrayContaining(['eci', 'swe_bench_verified', 'aime', 'cursorbench'])
    )
  })
})
