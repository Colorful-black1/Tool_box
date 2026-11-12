/** AI 模型世界的隔离验收桥接：只返回合成快照，不发网络请求。 */
module.exports = function createAiWorldFixture() {
  const copy = (value) => JSON.parse(JSON.stringify(value))
  let failNext = false
  let openCount = 0
  let openUrls = []

  const vendors = [
    {
      id: 'anthropic',
      name: 'Anthropic',
      nameZh: 'Anthropic',
      country: 'US',
      continent: 'west',
      motif: 'wanderer',
      accentColor: '#c9a55f',
      homepage: 'https://www.anthropic.com'
    },
    {
      id: 'openai',
      name: 'OpenAI',
      nameZh: 'OpenAI',
      country: 'US',
      continent: 'west',
      motif: 'wanderer',
      accentColor: '#7fe7ff',
      homepage: 'https://openai.com'
    },
    {
      id: 'deepseek',
      name: 'DeepSeek',
      nameZh: '深度求索',
      country: 'CN',
      continent: 'east',
      motif: 'wanderer',
      accentColor: '#7c8da6',
      homepage: 'https://www.deepseek.com'
    },
    {
      id: 'qwen',
      name: 'Qwen',
      nameZh: '通义千问',
      country: 'CN',
      continent: 'east',
      motif: 'wanderer',
      accentColor: '#e8c98a',
      homepage: 'https://tongyi.aliyun.com'
    },
    {
      id: 'meta',
      name: 'Meta',
      nameZh: 'Meta',
      country: 'US',
      continent: 'west',
      motif: 'wanderer',
      accentColor: '#ff9ec7',
      homepage: 'https://ai.meta.com'
    }
  ]

  const codingLeagues = ['swe_bench_verified', 'terminal_bench_2_0', 'cursorbench']
  const coding = (value) =>
    codingLeagues.map((league) => ({
      league,
      score: value,
      unit: 'pct',
      attribution: 'third-party',
      source: 'epoch.ai',
      sourceUrl: 'https://example.com/benchmarks'
    }))

  const base = {
    releaseDatePrecision: 'day',
    knowledgeCutoff: null,
    retiredAt: null,
    maxOutput: 8192,
    capabilities: {
      toolCall: true,
      reasoning: true,
      structuredOutput: null,
      promptCaching: true
    },
    params: { totalB: null, activeB: null, confidence: 'unknown', sizeTier: 4 },
    provenance: {},
    firstSeenAt: '2026-01-01',
    scores: [
      {
        league: 'eci',
        score: 100,
        unit: 'index',
        attribution: 'third-party',
        source: 'epoch.ai',
        sourceUrl: 'https://example.com/benchmarks'
      }
    ]
  }

  const models = [
    {
      ...base,
      id: 'anthropic/claude-fable-5-2',
      slug: 'anthropic-claude-fable-5-2',
      name: 'Claude Fable 5.2',
      vendorId: 'anthropic',
      releaseDate: '2026-10-01',
      contextWindow: 1000000,
      pricing: { inputPerMTok: 12, outputPerMTok: 60, cachedInputPerMTok: 0.2 },
      modalities: { input: ['text', 'image', 'pdf'], output: ['text'] },
      openWeights: false,
      license: null,
      coding: coding(92),
      benchmarks: {
        eci: 173.4,
        swe_bench_verified: 70,
        swe_bench_vendor: null,
        swe_bench_pro: null,
        aime: 99.7,
        gpqa_diamond: 93.8,
        arc_agi_2: 93.7,
        fiction_live: null,
        webdev_arena_elo: null
      }
    },
    {
      ...base,
      id: 'openai/gpt-6-astra',
      slug: 'openai-gpt-6-astra',
      name: 'GPT-6 Astra',
      vendorId: 'openai',
      releaseDate: '2026-11-01',
      contextWindow: 1000000,
      pricing: { inputPerMTok: 10, outputPerMTok: 50, cachedInputPerMTok: 0.5 },
      modalities: { input: ['text', 'image'], output: ['text'] },
      openWeights: false,
      license: null,
      coding: coding(95),
      benchmarks: {
        eci: 169.1,
        swe_bench_verified: null,
        swe_bench_vendor: null,
        swe_bench_pro: null,
        aime: 98,
        gpqa_diamond: 91,
        arc_agi_2: 90.4,
        fiction_live: null,
        webdev_arena_elo: null
      }
    },
    {
      ...base,
      id: 'deepseek/deepseek-v4-flash',
      slug: 'deepseek-v4-flash',
      name: 'DeepSeek V4 Flash',
      vendorId: 'deepseek',
      releaseDate: '2026-09-01',
      contextWindow: 512000,
      pricing: { inputPerMTok: 0.05, outputPerMTok: 0.2, cachedInputPerMTok: 0.01 },
      modalities: { input: ['text', 'image'], output: ['text'] },
      openWeights: true,
      license: 'MIT',
      coding: coding(85),
      benchmarks: {
        eci: 156.6,
        swe_bench_verified: null,
        swe_bench_vendor: null,
        swe_bench_pro: null,
        aime: 90,
        gpqa_diamond: 80,
        arc_agi_2: 70,
        fiction_live: null,
        webdev_arena_elo: null
      }
    },
    {
      ...base,
      id: 'qwen/qwen3-8-max',
      slug: 'qwen3-8-max',
      name: 'Qwen3.8 Max',
      vendorId: 'qwen',
      releaseDate: '2026-08-01',
      contextWindow: 256000,
      pricing: { inputPerMTok: 0.1, outputPerMTok: 0.5, cachedInputPerMTok: 0.01 },
      modalities: { input: ['text'], output: ['text'] },
      openWeights: true,
      license: 'Apache-2.0',
      coding: coding(80),
      benchmarks: {
        eci: 140,
        swe_bench_verified: null,
        swe_bench_vendor: null,
        swe_bench_pro: null,
        aime: 80,
        gpqa_diamond: 70,
        arc_agi_2: 60,
        fiction_live: null,
        webdev_arena_elo: null
      }
    },
    {
      ...base,
      id: 'meta/mini-cheap',
      slug: 'meta-mini-cheap',
      name: 'Mini Cheap',
      vendorId: 'meta',
      releaseDate: '2026-07-01',
      contextWindow: 128000,
      pricing: { inputPerMTok: 0.02, outputPerMTok: 0.1, cachedInputPerMTok: null },
      modalities: { input: ['text'], output: ['text'] },
      openWeights: false,
      license: null,
      coding: coding(60),
      benchmarks: {
        eci: 105,
        swe_bench_verified: null,
        swe_bench_vendor: null,
        swe_bench_pro: null,
        aime: 40,
        gpqa_diamond: 30,
        arc_agi_2: null,
        fiction_live: null,
        webdev_arena_elo: null
      }
    },
    {
      ...base,
      id: 'openai/gpt-image-2',
      slug: 'openai-gpt-image-2',
      name: 'GPT Image 2',
      vendorId: 'openai',
      releaseDate: '2026-06-01',
      contextWindow: null,
      pricing: { inputPerMTok: null, outputPerMTok: null, cachedInputPerMTok: null },
      modalities: { input: ['text', 'image'], output: ['image'] },
      openWeights: false,
      license: null,
      coding: [],
      scores: [],
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
      }
    }
  ]

  const snapshot = {
    generatedAt: '2026-11-12T01:42:43.147Z',
    sources: { 'epoch.ai': { ok: true, fetchedAt: '2026-11-12T01:42:43.147Z' } },
    vendors,
    models,
    benchmarks: []
  }

  return {
    bridge: {
      get: async () => {
        if (failNext) {
          failNext = false
          throw new Error('AI 模型数据更新失败，正在显示上次缓存')
        }
        return {
          snapshot: copy(snapshot),
          fetchedAtMs: Date.now(),
          source: 'network',
          stale: false,
          warning: null
        }
      },
      openSource: async (url) => {
        openCount++
        openUrls.push(url)
      }
    },
    controls: {
      failNextAiWorld: () => {
        failNext = true
      },
      aiWorldOpenCount: () => openCount,
      aiWorldOpenUrls: () => openUrls.slice()
    }
  }
}
