/**
 * Artificial Analysis 模型榜：ToolBox 原生采集快照的只读契约。
 *
 * 数据来自官方 Data API 免费档 `/api/v2/language/models/free`，由主进程抓取、
 * 校验并缓存；渲染层只消费归一化后的结构。AA Intelligence Index 与 Epoch ECI
 * 是两套独立评测，不合并、不互相换算。
 */

export type AiWorldAaCapabilityKey =
  | 'financeAndAccounting'
  | 'strategyAndOps'
  | 'legal'
  | 'healthcareAndMedical'
  | 'engineering'
  | 'economics'

/** 六项行业能力指数的显示顺序与文案。 */
export const AI_WORLD_AA_CAPABILITIES: ReadonlyArray<{
  key: AiWorldAaCapabilityKey
  label: string
}> = [
  { key: 'financeAndAccounting', label: '金融与会计' },
  { key: 'strategyAndOps', label: '战略与运营' },
  { key: 'legal', label: '法律' },
  { key: 'healthcareAndMedical', label: '医疗健康' },
  { key: 'engineering', label: '工程' },
  { key: 'economics', label: '经济' }
]

export type AiWorldAaCapabilityIndexes = Record<AiWorldAaCapabilityKey, number | null>

export interface AiWorldAaModel {
  id: string
  slug: string
  name: string
  creator: string
  releaseDate: string | null
  intelligenceIndex: number | null
  capabilityIndexes: AiWorldAaCapabilityIndexes
  /** AA Intelligence Index 的加权平均每任务成本（USD）。 */
  costPerTask: number | null
  inputPricePerMTok: number | null
  outputPricePerMTok: number | null
  outputTokensPerSecond: number | null
  timeToFirstTokenSeconds: number | null
  timeToFirstAnswerTokenSeconds: number | null
}

export interface AiWorldAaSnapshot {
  generatedAt: string
  /** AA Intelligence Index 的主次版本号，例如 5 表示 v5.x。 */
  intelligenceIndexVersion: number | null
  models: AiWorldAaModel[]
}

export interface AiWorldAaSourceState {
  configured: boolean
  ok: boolean
  /** 最近一次成功抓取时间；失败时保留上次成功时间。 */
  fetchedAt: string | null
  /** 最近一次检查时间，包括失败。 */
  checkedAt: string | null
  /** 免费档 24 小时窗口剩余请求数；未知时为 null。 */
  quotaRemaining: number | null
  /** 配额重置时间（ISO）；未知时为 null。 */
  quotaResetAt: string | null
  note?: string
}

export type AiWorldAaResultSource = 'network' | 'cache' | 'none'

export interface AiWorldAaResult {
  snapshot: AiWorldAaSnapshot | null
  fetchedAtMs: number | null
  source: AiWorldAaResultSource
  stale: boolean
  state: AiWorldAaSourceState
}

export interface AiWorldAaQuery {
  /** 只读本地缓存；没有缓存时不发起请求。 */
  allowStale?: boolean
  /** 跳过 TTL，强制刷新；仍受手动刷新冷却限制。 */
  force?: boolean
}

export interface AiWorldAaKeyInput {
  apiKey: string
}

export interface AiWorldAaKeyStatus {
  configured: boolean
}

export type AiWorldAaFrontierMetric = 'cost' | 'price'

export interface AiWorldAaFrontierPoint {
  model: AiWorldAaModel
  /** 横轴值：每任务成本或输出价格（USD）。 */
  value: number
  intelligence: number
  isFrontier: boolean
}

/**
 * AA 智能 × 成本前沿：按横轴升序扫描，保留刷新过最高智能指数的点。
 * 只纳入智能指数与所选成本字段都有值的模型；缺失字段不填 0。
 */
export function buildAiWorldAaFrontier(
  models: readonly AiWorldAaModel[],
  metric: AiWorldAaFrontierMetric
): { points: AiWorldAaFrontierPoint[]; frontier: AiWorldAaFrontierPoint[] } {
  const candidates: AiWorldAaFrontierPoint[] = []
  for (const model of models) {
    const value = metric === 'cost' ? model.costPerTask : model.outputPricePerMTok
    if (value == null || value <= 0 || model.intelligenceIndex == null) continue
    candidates.push({
      model,
      value,
      intelligence: model.intelligenceIndex,
      isFrontier: false
    })
  }
  const sorted = [...candidates].sort(
    (a, b) => a.value - b.value || b.intelligence - a.intelligence
  )
  let highest = Number.NEGATIVE_INFINITY
  for (const point of sorted) {
    if (point.intelligence <= highest) continue
    point.isFrontier = true
    highest = point.intelligence
  }
  const points = [...candidates].sort((a, b) =>
    a.model.name.localeCompare(b.model.name)
  )
  const frontier = points.filter((point) => point.isFrontier).sort((a, b) => a.value - b.value)
  return { points, frontier }
}

export const AI_WORLD_AA_SOURCE_LABEL = 'Artificial Analysis'
export const AI_WORLD_AA_SOURCE_URL = 'https://artificialanalysis.ai'
export const AI_WORLD_AA_MODELS_URL = 'https://artificialanalysis.ai/models'
export const AI_WORLD_AA_KEY_URL = 'https://artificialanalysis.ai/api-key-management-redirect'
export const AI_WORLD_AA_API_BASE = 'https://artificialanalysis.ai/api/v2'
export const AI_WORLD_AA_FREE_DAILY_LIMIT = 100

/** 免费档数据变化不快；与主模型快照保持同样的 12 小时节奏。 */
export const AI_WORLD_AA_TTL_MS = 12 * 60 * 60 * 1000
/** 手动刷新冷却，避免连续点击消耗免费额度。 */
export const AI_WORLD_AA_REFRESH_COOLDOWN_MS = 5 * 60 * 1000
/** 分页保护：正常远小于此值，异常时避免无限翻页。 */
export const AI_WORLD_AA_MAX_PAGES = 20
