import type {
  AiWorldAaCapabilityIndexes,
  AiWorldAaCapabilityKey,
  AiWorldAaModel
} from '../../../shared/ai-world-aa'
import { AiWorldAaError } from './errors'

export interface ParsedAaPage {
  models: AiWorldAaModel[]
  hasMore: boolean
  intelligenceIndexVersion: number | null
  tier: string | null
}

const CAPABILITY_FIELDS: Record<AiWorldAaCapabilityKey, string> = {
  financeAndAccounting: 'artificial_analysis_finance_and_accounting_index',
  strategyAndOps: 'artificial_analysis_strategy_and_ops_index',
  legal: 'artificial_analysis_legal_index',
  healthcareAndMedical: 'artificial_analysis_healthcare_and_medical_index',
  engineering: 'artificial_analysis_engineering_index',
  economics: 'artificial_analysis_economics_index'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function text(value: unknown, max = 200): string {
  if (typeof value !== 'string') return ''
  return value.replace(/\s+/g, ' ').trim().slice(0, max)
}

function number(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function emptyCapabilities(): AiWorldAaCapabilityIndexes {
  return {
    financeAndAccounting: null,
    strategyAndOps: null,
    legal: null,
    healthcareAndMedical: null,
    engineering: null,
    economics: null
  }
}

function parseCapabilities(evaluations: Record<string, unknown>): AiWorldAaCapabilityIndexes {
  const result = emptyCapabilities()
  for (const [key, field] of Object.entries(CAPABILITY_FIELDS) as Array<
    [AiWorldAaCapabilityKey, string]
  >) {
    result[key] = number(evaluations[field])
  }
  return result
}

function parseModel(raw: unknown): AiWorldAaModel | null {
  if (!isRecord(raw)) return null
  const id = text(raw.id, 80)
  const slug = text(raw.slug, 120) || id
  const name = text(raw.name, 160)
  if (!id || !slug || !name) return null

  const creator = isRecord(raw.model_creator) ? text(raw.model_creator.name, 120) : ''
  const evaluations = isRecord(raw.evaluations) ? raw.evaluations : {}
  const cost = isRecord(raw.artificial_analysis_intelligence_index_cost)
    ? raw.artificial_analysis_intelligence_index_cost
    : null
  const costPerTask = cost && isRecord(cost.cost_per_task) ? cost.cost_per_task : null
  const pricing = isRecord(raw.pricing) ? raw.pricing : null
  const performance =
    raw.performance_v3 != null && isRecord(raw.performance_v3) ? raw.performance_v3 : null
  const releaseDate = text(raw.release_date, 20)

  return {
    id,
    slug,
    name,
    creator,
    releaseDate: /^\d{4}-\d{2}-\d{2}$/.test(releaseDate) ? releaseDate : null,
    intelligenceIndex: number(evaluations.artificial_analysis_intelligence_index),
    capabilityIndexes: parseCapabilities(evaluations),
    costPerTask: costPerTask ? number(costPerTask.total_cost) : null,
    inputPricePerMTok: pricing ? number(pricing.price_1m_input_tokens) : null,
    outputPricePerMTok: pricing ? number(pricing.price_1m_output_tokens) : null,
    outputTokensPerSecond: performance ? number(performance.mean_output_tokens_per_second) : null,
    timeToFirstTokenSeconds: performance
      ? number(performance.mean_time_to_first_token_seconds)
      : null,
    timeToFirstAnswerTokenSeconds: performance
      ? number(performance.mean_time_to_first_answer_token_seconds)
      : null
  }
}

/** 解析免费档单页响应；未知字段忽略，缺行跳过，整页结构异常才报错。 */
export function parseAiWorldAaPage(value: unknown): ParsedAaPage {
  if (!isRecord(value)) throw new AiWorldAaError('Artificial Analysis 响应不是对象')
  if (!Array.isArray(value.data))
    throw new AiWorldAaError('Artificial Analysis 响应缺少模型列表')
  const pagination = isRecord(value.pagination) ? value.pagination : null
  const models: AiWorldAaModel[] = []
  for (const row of value.data) {
    const model = parseModel(row)
    if (model) models.push(model)
  }
  return {
    models,
    hasMore: pagination?.has_more === true,
    intelligenceIndexVersion: number(value.intelligence_index_version),
    tier: text(value.tier, 20) || null
  }
}
