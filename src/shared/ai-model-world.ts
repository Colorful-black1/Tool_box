/**
 * AI 模型世界：ToolBox 原生采集快照的数据契约与只读派生逻辑。
 *
 * 数据由主进程直接读取 models.dev 与 Epoch AI，并在本机归一化；
 * ai-model-world 仅作为字段规则与交互参考，不参与运行时数据读取。
 *
 * 这里不发起任何网络请求，也不依赖 Node API；主进程负责读取 / 校验快照，
 * 渲染层只消费同一份结构。
 */

export type AiWorldConfidence = 'exact' | 'estimated' | 'unknown'
export type AiWorldDatePrecision = 'day' | 'month' | 'year'
export type AiWorldModality = 'text' | 'image' | 'audio' | 'video' | 'pdf'
export type AiWorldSourceId =
  | 'models.dev'
  | 'epoch.ai'
  | 'huggingface'
  | 'openrouter'
  | 'vercel-gateway'
  | 'litellm'
  | 'livebench'
  | 'lmarena'
  | 'derived'
  | 'override'

export type AiWorldScoreUnit = 'pct' | 'elo' | 'index' | 'minutes' | 'usd'
export type AiWorldAttribution = 'third-party' | 'vendor-self-reported'

export interface AiWorldBenchmarks {
  eci: number | null
  swe_bench_verified: number | null
  swe_bench_vendor: number | null
  swe_bench_pro: number | null
  aime: number | null
  gpqa_diamond: number | null
  arc_agi_2: number | null
  fiction_live: number | null
  webdev_arena_elo: number | null
}

export interface AiWorldBenchmarkScore {
  league: string
  score: number
  unit: AiWorldScoreUnit
  attribution: AiWorldAttribution
  source: AiWorldSourceId
  sourceUrl: string | null
}

export interface AiWorldBenchmarkMeta {
  id: string
  sourceFile: string
  scoreColumn: string
  unit: AiWorldScoreUnit
  randomBaseline: number | null
  scoreCeiling: number | null
  releaseDate: string | null
  supersededBy: string | null
  inEci: boolean
  models: number
}

export interface AiWorldPricing {
  inputPerMTok: number | null
  outputPerMTok: number | null
  cachedInputPerMTok: number | null
}

export interface AiWorldParams {
  totalB: number | null
  activeB: number | null
  confidence: AiWorldConfidence
  sizeTier?: 1 | 2 | 3 | 4 | 5
  sizeTierBasis?: 'price+naming' | 'price' | 'naming'
}

export interface AiWorldCapabilities {
  toolCall: boolean | null
  reasoning: boolean | null
  structuredOutput: boolean | null
  promptCaching: boolean | null
}

export interface AiWorldModel {
  id: string
  slug: string
  name: string
  vendorId: string
  releaseDate: string | null
  releaseDatePrecision: AiWorldDatePrecision | null
  knowledgeCutoff: string | null
  retiredAt: string | null
  contextWindow: number | null
  maxOutput: number | null
  pricing: AiWorldPricing
  modalities: { input: AiWorldModality[]; output: AiWorldModality[] }
  capabilities: AiWorldCapabilities
  openWeights: boolean | null
  license: string | null
  params: AiWorldParams
  benchmarks: AiWorldBenchmarks
  coding: AiWorldBenchmarkScore[]
  scores?: AiWorldBenchmarkScore[]
  trainingComputeFlop?: number | null
  provenance: Partial<Record<string, AiWorldSourceId>>
  firstSeenAt: string
}

export interface AiWorldVendor {
  id: string
  name: string
  nameZh: string
  country: string
  continent: 'west' | 'east'
  motif: string
  accentColor: string
  homepage: string | null
}

export interface AiWorldSourceState {
  ok: boolean
  fetchedAt: string | null
  note?: string
}

export interface AiWorldSnapshot {
  generatedAt: string
  sources: Record<string, AiWorldSourceState>
  vendors: AiWorldVendor[]
  models: AiWorldModel[]
  benchmarks?: AiWorldBenchmarkMeta[]
}

export interface AiWorldQuery {
  /** 只读本地缓存，不发起网络请求；没有缓存时仍会尝试采集。 */
  allowStale?: boolean
  /** 跳过 TTL，强制请求原始数据源。 */
  force?: boolean
}

export interface AiWorldResult {
  snapshot: AiWorldSnapshot
  fetchedAtMs: number
  source: 'network' | 'cache'
  stale: boolean
  warning: string | null
}

/** 上游 GitHub Actions 每 12 小时同步一次；超过这个时间就主动刷新。 */
export const AI_WORLD_CACHE_TTL_MS = 12 * 60 * 60 * 1000

export type AiWorldKind = 'text' | 'vision' | 'omni' | 'image' | 'video' | 'audio'

export const AI_WORLD_KIND_LABELS: Record<AiWorldKind, string> = {
  text: '文本',
  vision: '视觉',
  omni: '全模态',
  image: '图像生成',
  video: '视频生成',
  audio: '语音'
}

export type AiWorldChampionKey =
  'smart' | 'code' | 'value' | 'cheap' | 'memory' | 'newest' | 'east' | 'open'

export interface AiWorldCodingConsensus {
  score: number
  leagues: number
  leagueIds: string[]
}

export interface AiWorldMetrics {
  rank: number | null
  eci: number | null
  eciPercentile: number | null
  code: AiWorldCodingConsensus | null
  value: number | null
  contextPercentile: number | null
  cheapPercentile: number | null
  outputPrice: number | null
}

export interface AiWorldChampion {
  key: AiWorldChampionKey
  model: AiWorldModel
  vendor: AiWorldVendor | undefined
}

export interface AiWorldIndex {
  snapshot: AiWorldSnapshot
  vendors: ReadonlyMap<string, AiWorldVendor>
  alive: AiWorldModel[]
  ranks: ReadonlyMap<string, number>
  champions: AiWorldChampion[]
  metricsOf(model: AiWorldModel): AiWorldMetrics
  scoresOf(model: AiWorldModel): AiWorldBenchmarkScore[]
}

export interface AiWorldFrontierPoint {
  model: AiWorldModel
  price: number
  eci: number
}

export interface AiWorldFrontier {
  /** 所有同时具备文本输出价格和 ECI 的模型，按价格升序。 */
  points: AiWorldFrontierPoint[]
  /** 每个价位上 ECI 最高的模型，且只保留刷新过此前最高 ECI 的点。 */
  frontier: AiWorldFrontierPoint[]
  priceRange: [number, number] | null
  eciRange: [number, number] | null
}

/**
 * 能力-价格前沿：同价位下 ECI 最高的模型连线。
 * 这是 ToolBox 自己的 ECI × 输出价格视图，不是 Artificial Analysis 的 IQ / 每任务成本。
 */
export function buildAiWorldFrontier(
  models: AiWorldModel[],
  metricsOf: (model: AiWorldModel) => AiWorldMetrics
): AiWorldFrontier {
  const points: AiWorldFrontierPoint[] = []
  for (const model of models) {
    if (model.retiredAt != null) continue
    if (!model.modalities.output.includes('text')) continue
    const price = model.pricing.outputPerMTok
    const eci = metricsOf(model).eci
    if (price == null || price <= 0 || eci == null || !Number.isFinite(eci)) continue
    points.push({ model, price, eci })
  }
  points.sort((a, b) => a.price - b.price || b.eci - a.eci || a.model.id.localeCompare(b.model.id))

  const frontier: AiWorldFrontierPoint[] = []
  let highest = Number.NEGATIVE_INFINITY
  for (const point of points) {
    if (point.eci > highest) {
      frontier.push(point)
      highest = point.eci
    }
  }

  if (points.length === 0) return { points, frontier, priceRange: null, eciRange: null }
  return {
    points,
    frontier,
    priceRange: [points[0].price, points[points.length - 1].price],
    eciRange: [
      Math.min(...points.map((point) => point.eci)),
      Math.max(...points.map((point) => point.eci))
    ]
  }
}

function percentile(sorted: number[], value: number): number {
  if (sorted.length === 0) return 0.5
  if (sorted.length === 1) return 0.5
  let lo = 0
  let hi = sorted.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (sorted[mid] < value) lo = mid + 1
    else hi = mid
  }
  return lo / (sorted.length - 1)
}

function textPrice(model: AiWorldModel): number | null {
  if (!model.modalities.output.includes('text')) return null
  const price = model.pricing.outputPerMTok
  return price != null && price > 0 ? price : null
}

function releaseTime(model: AiWorldModel): number | null {
  if (!model.releaseDate) return null
  const parts = model.releaseDate.split('-').map(Number)
  const time = Date.UTC(parts[0], (parts[1] ?? 1) - 1, parts[2] ?? 1)
  return Number.isNaN(time) ? null : time
}

/** 模型类型只由模态推导，不看名字。 */
export function aiWorldKindOf(model: AiWorldModel): AiWorldKind {
  const input = new Set(model.modalities.input)
  const output = new Set(model.modalities.output)
  if (output.has('video')) return 'video'
  if (output.has('image')) return 'image'
  if (output.has('audio')) return 'audio'
  if (input.has('audio')) return 'omni'
  if (input.has('image') || input.has('video') || input.has('pdf')) return 'vision'
  return 'text'
}

export function hasCoreData(model: AiWorldModel): boolean {
  return model.contextWindow != null || model.pricing.outputPerMTok != null
}

/** 编程共识：只在第三方、同一赛制的池内取分位，再跨赛制取平均。 */
export function buildCodingConsensus(
  models: AiWorldModel[]
): (model: AiWorldModel) => AiWorldCodingConsensus | null {
  const pools = new Map<string, number[]>()
  for (const model of models) {
    for (const score of model.coding ?? []) {
      if (score.attribution !== 'third-party') continue
      const pool = pools.get(score.league)
      if (pool) pool.push(score.score)
      else pools.set(score.league, [score.score])
    }
  }
  for (const pool of pools.values()) pool.sort((a, b) => a - b)

  const cache = new Map<string, AiWorldCodingConsensus | null>()
  return (model) => {
    const cached = cache.get(model.id)
    if (cached !== undefined) return cached
    const values: number[] = []
    const ids: string[] = []
    for (const score of model.coding ?? []) {
      if (score.attribution !== 'third-party') continue
      const pool = pools.get(score.league)
      if (!pool || pool.length < 5) continue
      values.push(percentile(pool, score.score))
      ids.push(score.league)
    }
    const result =
      values.length >= 3
        ? {
            score: values.reduce((sum, value) => sum + value, 0) / values.length,
            leagues: values.length,
            leagueIds: ids
          }
        : null
    cache.set(model.id, result)
    return result
  }
}

function buildRanks(models: AiWorldModel[]): Map<string, number> {
  const ranked = models
    .filter((model) => model.benchmarks.eci != null)
    .sort((a, b) => b.benchmarks.eci! - a.benchmarks.eci! || a.id.localeCompare(b.id))
  return new Map(ranked.map((model, index) => [model.id, index + 1]))
}

function best(
  pool: AiWorldModel[],
  value: (model: AiWorldModel) => number | null,
  order: 'desc' | 'asc' = 'desc'
): { model: AiWorldModel; value: number } | null {
  let picked: { model: AiWorldModel; value: number } | null = null
  for (const model of pool) {
    const current = value(model)
    if (current == null) continue
    if (!picked) {
      picked = { model, value: current }
      continue
    }
    const better = order === 'desc' ? current > picked.value : current < picked.value
    if (better) {
      picked = { model, value: current }
      continue
    }
    if (current === picked.value) {
      const a = model.benchmarks.eci ?? -1
      const b = picked.model.benchmarks.eci ?? -1
      if (a > b || (a === b && model.id < picked.model.id)) picked = { model, value: current }
    }
  }
  return picked
}

function fixedBenchmarkScores(model: AiWorldModel): AiWorldBenchmarkScore[] {
  const scores: AiWorldBenchmarkScore[] = []
  const push = (
    league: string,
    score: number | null,
    unit: AiWorldScoreUnit,
    attribution: AiWorldAttribution,
    source: AiWorldSourceId
  ): void => {
    if (score == null) return
    scores.push({ league, score, unit, attribution, source, sourceUrl: null })
  }
  push('eci', model.benchmarks.eci, 'index', 'third-party', 'epoch.ai')
  push('swe_bench_verified', model.benchmarks.swe_bench_verified, 'pct', 'third-party', 'epoch.ai')
  push(
    'swe_bench_vendor',
    model.benchmarks.swe_bench_vendor,
    'pct',
    'vendor-self-reported',
    'models.dev'
  )
  push('swe_bench_pro', model.benchmarks.swe_bench_pro, 'pct', 'vendor-self-reported', 'models.dev')
  push('aime', model.benchmarks.aime, 'pct', 'third-party', 'epoch.ai')
  push('gpqa_diamond', model.benchmarks.gpqa_diamond, 'pct', 'third-party', 'epoch.ai')
  push('arc_agi_2', model.benchmarks.arc_agi_2, 'pct', 'third-party', 'epoch.ai')
  push('fiction_live', model.benchmarks.fiction_live, 'pct', 'third-party', 'epoch.ai')
  push('webdev_arena_elo', model.benchmarks.webdev_arena_elo, 'elo', 'third-party', 'epoch.ai')
  return scores
}

function buildScoresOf(model: AiWorldModel): AiWorldBenchmarkScore[] {
  const source = model.scores?.length
    ? model.scores
    : [...(model.coding ?? []), ...fixedBenchmarkScores(model)]
  const seen = new Set<string>()
  return source.filter((score) => {
    const key = `${score.league}::${score.attribution}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/**
 * 一次构建整页需要的标尺：名次、能力分位、编程共识、今日格局。
 * 所有分位都基于当前快照的全体模型，避免只看当前筛选结果造成档位失真。
 */
export function createAiWorldIndex(snapshot: AiWorldSnapshot): AiWorldIndex {
  const vendors = new Map(snapshot.vendors.map((vendor) => [vendor.id, vendor]))
  const alive = snapshot.models.filter((model) => !model.retiredAt)
  const ranks = buildRanks(alive)
  const eciAsc = alive
    .map((model) => model.benchmarks.eci)
    .filter((value): value is number => value != null)
    .sort((a, b) => a - b)
  const contextAsc = alive
    .map((model) => model.contextWindow)
    .filter((value): value is number => value != null && value > 0)
    .map((value) => Math.log10(value))
    .sort((a, b) => a - b)
  const priceAsc = alive
    .filter((model) => model.modalities.output.includes('text'))
    .map((model) => model.pricing.outputPerMTok)
    .filter((value): value is number => value != null && value > 0)
    .map((value) => Math.log10(value))
    .sort((a, b) => a - b)
  const codingOf = buildCodingConsensus(alive)
  const scoresCache = new Map<string, AiWorldBenchmarkScore[]>()
  const metricsCache = new Map<string, AiWorldMetrics>()

  const scoresOf = (model: AiWorldModel): AiWorldBenchmarkScore[] => {
    const cached = scoresCache.get(model.id)
    if (cached) return cached
    const scores = buildScoresOf(model)
    scoresCache.set(model.id, scores)
    return scores
  }

  const metricsOf = (model: AiWorldModel): AiWorldMetrics => {
    const cached = metricsCache.get(model.id)
    if (cached) return cached
    const eci = model.benchmarks.eci
    const eciPercentile = eci == null ? null : percentile(eciAsc, eci)
    const context = model.contextWindow
    const contextPercentile =
      context == null || context <= 0 ? null : percentile(contextAsc, Math.log10(context))
    const price = textPrice(model)
    const pricePercentile = price == null ? null : percentile(priceAsc, Math.log10(price))
    const metrics: AiWorldMetrics = {
      rank: ranks.get(model.id) ?? null,
      eci,
      eciPercentile,
      code: codingOf(model),
      value:
        eciPercentile == null || pricePercentile == null ? null : eciPercentile - pricePercentile,
      contextPercentile,
      cheapPercentile: pricePercentile == null ? null : 1 - pricePercentile,
      outputPrice: model.pricing.outputPerMTok
    }
    metricsCache.set(model.id, metrics)
    return metrics
  }

  const generatedAt = new Date(snapshot.generatedAt)
  const now = Number.isNaN(generatedAt.getTime()) ? new Date() : generatedAt
  const scored = alive.filter((model) => model.benchmarks.eci != null)
  const trusted = alive.filter(hasCoreData)
  const champions: AiWorldChampion[] = []
  const push = (key: AiWorldChampionKey, hit: { model: AiWorldModel } | null): void => {
    if (hit) champions.push({ key, model: hit.model, vendor: vendors.get(hit.model.vendorId) })
  }

  push(
    'smart',
    best(alive, (model) => model.benchmarks.eci)
  )
  push(
    'code',
    best(alive, (model) => metricsOf(model).code?.score ?? null)
  )
  push(
    'value',
    best(alive, (model) => metricsOf(model).value)
  )
  push('cheap', best(scored, textPrice, 'asc'))
  push(
    'memory',
    best(scored, (model) => model.contextWindow)
  )
  push(
    'newest',
    best(
      trusted.filter((model) => {
        const time = releaseTime(model)
        return time != null && time <= now.getTime()
      }),
      releaseTime
    )
  )
  push(
    'east',
    best(
      alive.filter((model) => vendors.get(model.vendorId)?.continent === 'east'),
      (model) => model.benchmarks.eci
    )
  )
  push(
    'open',
    best(
      alive.filter((model) => model.openWeights === true),
      (model) => model.benchmarks.eci
    )
  )

  return { snapshot, vendors, alive, ranks, champions, metricsOf, scoresOf }
}
