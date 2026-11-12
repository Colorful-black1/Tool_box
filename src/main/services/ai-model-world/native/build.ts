import type {
  AiWorldBenchmarkScore,
  AiWorldBenchmarks,
  AiWorldModel,
  AiWorldSnapshot,
  AiWorldVendor
} from '../../../../shared/ai-model-world'
import type { ModelsDevData, ModelsDevRecord } from './models-dev'
import type { EpochData, EpochModel } from './epoch'
import { normalizeVendorId, vendorFromOrganization, vendorSeed } from './vendors'

export interface BuildNativeSnapshotOptions {
  now: Date
  modelsDev: ModelsDevData
  epoch?: EpochData
  epochOk?: boolean
  epochError?: string | null
}

interface VendorInfo {
  providerName: string
  country: string
}

const CODING_LEAGUES = new Set([
  'swe_bench_verified',
  'terminal_bench',
  'aider_polyglot',
  'cursorbench',
  'deepswe',
  'frontier_code',
  'frontier_swe',
  'livebench_coding'
])

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '')
}

function nameVariants(value: string): string[] {
  const base = value.trim()
  const out = new Set<string>()
  for (const candidate of [
    base,
    base.replace(/\b(preview|pre-release|experimental|exp|beta|latest)\b/gi, ' '),
    base.replace(/-(?:preview|pre-release|experimental|exp|beta|latest)$/i, '')
  ]) {
    const key = normalize(candidate)
    if (key) out.add(key)
  }
  return [...out]
}

function idTail(id: string): string {
  return id.split('/').pop() ?? id
}

function emptyBenchmarks(): AiWorldBenchmarks {
  return {
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

function benchmarksFromScores(scores: AiWorldBenchmarkScore[]): AiWorldBenchmarks {
  const byLeague = new Map(scores.map((score) => [score.league, score]))
  const value = (league: string): number | null => byLeague.get(league)?.score ?? null
  return {
    eci: value('eci'),
    swe_bench_verified: value('swe_bench_verified'),
    swe_bench_vendor: value('swe_bench_vendor'),
    swe_bench_pro: value('swe_bench_pro'),
    aime: value('aime'),
    gpqa_diamond: value('gpqa_diamond'),
    arc_agi_2: value('arc_agi_2'),
    fiction_live: value('fiction_live'),
    webdev_arena_elo: value('webdev_arena_elo')
  }
}

function modelFromDev(record: ModelsDevRecord, now: string): AiWorldModel {
  return {
    id: record.id,
    slug: record.id.replace(/\//g, '-'),
    name: record.name,
    vendorId: normalizeVendorId(record.vendorId),
    releaseDate: record.releaseDate,
    releaseDatePrecision: record.releaseDate ? 'day' : null,
    knowledgeCutoff: record.knowledgeCutoff,
    retiredAt: null,
    contextWindow: record.contextWindow,
    maxOutput: record.maxOutput,
    pricing: record.pricing,
    modalities: record.modalities,
    capabilities: record.capabilities,
    openWeights: record.openWeights,
    license: record.license,
    params: { totalB: null, activeB: null, confidence: 'unknown' },
    benchmarks: emptyBenchmarks(),
    coding: [],
    scores: [],
    provenance: { pricing: 'models.dev' },
    firstSeenAt: now
  }
}

function modelFromEpoch(epoch: EpochModel, vendorId: string, now: string): AiWorldModel {
  return {
    id: '',
    slug: '',
    name: epoch.name,
    vendorId,
    releaseDate: epoch.releaseDate,
    releaseDatePrecision: epoch.releaseDate ? 'day' : null,
    knowledgeCutoff: null,
    retiredAt: null,
    contextWindow: null,
    maxOutput: null,
    pricing: { inputPerMTok: null, outputPerMTok: null, cachedInputPerMTok: null },
    modalities: { input: ['text'], output: ['text'] },
    capabilities: {
      toolCall: null,
      reasoning: null,
      structuredOutput: null,
      promptCaching: null
    },
    openWeights: epoch.openWeights,
    license: null,
    params: { totalB: null, activeB: null, confidence: 'unknown' },
    benchmarks: emptyBenchmarks(),
    coding: [],
    scores: [],
    provenance: { benchmarks: 'epoch.ai' },
    firstSeenAt: now
  }
}

export function buildNativeSnapshot(options: BuildNativeSnapshotOptions): AiWorldSnapshot {
  const nowIso = options.now.toISOString()
  const models: AiWorldModel[] = []
  const vendorInfo = new Map<string, VendorInfo>()
  const byName = new Map<string, AiWorldModel>()
  const byTail = new Map<string, AiWorldModel>()

  const rememberVendor = (vendorId: string, providerName: string, country: string): void => {
    const current = vendorInfo.get(vendorId)
    if (!current) vendorInfo.set(vendorId, { providerName, country })
    else if (!current.country && country) current.country = country
  }

  for (const record of options.modelsDev.records) {
    const model = modelFromDev(record, nowIso)
    models.push(model)
    for (const key of nameVariants(record.name)) {
      if (!byName.has(key)) byName.set(key, model)
    }
    for (const key of nameVariants(idTail(record.id))) {
      if (!byTail.has(key)) byTail.set(key, model)
    }
    rememberVendor(model.vendorId, record.providerName, '')
  }

  const allEpochModels = options.epoch?.models ?? []
  const usedNewIds = new Set(models.map((model) => model.id))

  for (const epoch of allEpochModels) {
    const epochKeys = new Set<string>()
    for (const key of nameVariants(epoch.name)) epochKeys.add(key)
    epochKeys.add(epoch.key)

    let matched: AiWorldModel | undefined
    for (const key of epochKeys) {
      matched = byName.get(key) ?? byTail.get(key)
      if (matched) break
    }

    if (!matched) {
      const vendorId = normalizeVendorId(vendorFromOrganization(epoch.organization))
      const slugBase = normalize(epoch.name) || 'model'
      let id = `${vendorId}/${slugBase}`
      let suffix = 2
      while (usedNewIds.has(id)) id = `${vendorId}/${slugBase}-${suffix++}`
      usedNewIds.add(id)
      matched = modelFromEpoch(epoch, vendorId, nowIso)
      matched.id = id
      matched.slug = id.replace(/\//g, '-')
      models.push(matched)
      for (const key of epochKeys) if (!byName.has(key)) byName.set(key, matched)
    }

    if (epoch.releaseDate && (!matched.releaseDate || epoch.releaseDate > matched.releaseDate)) {
      matched.releaseDate = epoch.releaseDate
      matched.releaseDatePrecision = 'day'
    }
    if (matched.openWeights == null && epoch.openWeights != null)
      matched.openWeights = epoch.openWeights
    if (epoch.eci != null) matched.benchmarks.eci = epoch.eci
    matched.scores = epoch.scores
    matched.coding = epoch.coding.filter((score) => CODING_LEAGUES.has(score.league))
    matched.benchmarks = benchmarksFromScores(matched.scores)
    const providerName = epoch.organization || matched.vendorId
    rememberVendor(matched.vendorId, providerName, epoch.country)
  }

  const vendors: AiWorldVendor[] = []
  for (const [id, info] of vendorInfo) {
    const seed = vendorSeed(id, info.providerName, info.country)
    vendors.push({
      id: seed.id,
      name: seed.name,
      nameZh: seed.nameZh,
      country: seed.country,
      continent: seed.continent,
      motif: 'wanderer',
      accentColor: '#7c8da6',
      homepage: null
    })
  }
  vendors.sort((a, b) => a.name.localeCompare(b.name))

  const sources: AiWorldSnapshot['sources'] = {
    'models.dev': { ok: true, fetchedAt: nowIso },
    'epoch.ai':
      options.epochOk === false
        ? { ok: false, fetchedAt: null, note: options.epochError ?? '本次评测数据抓取失败' }
        : { ok: true, fetchedAt: nowIso }
  }

  return {
    generatedAt: nowIso,
    sources,
    vendors,
    models: models.sort((a, b) => a.id.localeCompare(b.id)),
    benchmarks: []
  }
}
