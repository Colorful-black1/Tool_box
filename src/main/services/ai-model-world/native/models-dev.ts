import type {
  AiWorldCapabilities,
  AiWorldModality,
  AiWorldPricing
} from '../../../../shared/ai-model-world'
import { fetchJson, NativeSourceError } from './http'
import type { FetchLike } from '../../github-trending/fetch'
import { normalizeVendorId } from './vendors'

interface RawModel {
  id?: string
  name?: string
  release_date?: string
  knowledge?: string
  modalities?: { input?: string[]; output?: string[] }
  open_weights?: boolean
  limit?: { context?: number; output?: number }
  cost?: { input?: number; output?: number; cache_read?: number }
  tool_call?: boolean
  reasoning?: boolean
  structured_output?: boolean
  license?: string
  canonical_model_id?: string
}

interface RawProvider {
  id?: string
  name?: string
  models?: Record<string, RawModel>
}

export interface ModelsDevRecord {
  id: string
  name: string
  vendorId: string
  providerName: string
  releaseDate: string | null
  knowledgeCutoff: string | null
  contextWindow: number | null
  maxOutput: number | null
  pricing: AiWorldPricing
  modalities: { input: AiWorldModality[]; output: AiWorldModality[] }
  capabilities: AiWorldCapabilities
  openWeights: boolean | null
  license: string | null
}

export interface ModelsDevData {
  records: ModelsDevRecord[]
  providerNames: Map<string, string>
}

const VALID_MODALITIES = new Set<AiWorldModality>(['text', 'image', 'audio', 'video', 'pdf'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function number(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

function modalities(raw: { input?: unknown; output?: unknown } | undefined): {
  input: AiWorldModality[]
  output: AiWorldModality[]
} {
  const list = (value: unknown): AiWorldModality[] => {
    if (!Array.isArray(value)) return []
    return [
      ...new Set(
        value.filter(
          (item): item is AiWorldModality =>
            typeof item === 'string' && VALID_MODALITIES.has(item as AiWorldModality)
        )
      )
    ]
  }
  const input = list(raw?.input)
  const output = list(raw?.output)
  return {
    input: input.length ? input : ['text'],
    output: output.length ? output : ['text']
  }
}

function pricing(raw: RawModel['cost']): AiWorldPricing {
  return {
    inputPerMTok: number(raw?.input),
    outputPerMTok: number(raw?.output),
    cachedInputPerMTok: number(raw?.cache_read)
  }
}

function capabilities(raw: RawModel): AiWorldCapabilities {
  return {
    toolCall: typeof raw.tool_call === 'boolean' ? raw.tool_call : null,
    reasoning: typeof raw.reasoning === 'boolean' ? raw.reasoning : null,
    structuredOutput: typeof raw.structured_output === 'boolean' ? raw.structured_output : null,
    promptCaching: null
  }
}

interface ApiCandidate {
  providerId: string
  providerName: string
  model: RawModel
}

/**
 * models.dev 的事实表与供应商报价表是两份数据：
 * models.json 给模型身份，api.json 给 provider × model 的上下文和价格。
 * 同一个 canonical model 可能被多家网关收录，优先取厂商自己的 provider，
 * 其次取第一个有输出价格的候选，避免把中转商的加价当成官方价格。
 */
export async function fetchModelsDev(fetchImpl: FetchLike): Promise<ModelsDevData> {
  const [factsRaw, providersRaw] = await Promise.all([
    fetchJson(fetchImpl, 'https://models.dev/models.json', 'models.dev 模型数据'),
    fetchJson(fetchImpl, 'https://models.dev/api.json', 'models.dev 供应商数据')
  ])
  if (!isRecord(factsRaw)) throw new NativeSourceError('models.dev 模型数据格式不正确')
  if (!isRecord(providersRaw)) throw new NativeSourceError('models.dev 供应商数据格式不正确')

  const providerNames = new Map<string, string>()
  const candidates = new Map<string, ApiCandidate[]>()
  for (const [providerKey, providerValue] of Object.entries(providersRaw)) {
    if (!isRecord(providerValue)) continue
    const provider = providerValue as RawProvider
    const providerId = normalizeVendorId(provider.id ?? providerKey)
    const providerName = text(provider.name) ?? providerId
    providerNames.set(providerId, providerName)
    if (!isRecord(provider.models)) continue
    for (const [modelKey, modelValue] of Object.entries(provider.models)) {
      if (!isRecord(modelValue)) continue
      const model = modelValue as RawModel
      const canonical = text(model.canonical_model_id) ?? `${providerKey}/${model.id ?? modelKey}`
      const list = candidates.get(canonical) ?? []
      list.push({ providerId, providerName, model })
      candidates.set(canonical, list)
    }
  }

  const records: ModelsDevRecord[] = []
  for (const [key, rawValue] of Object.entries(factsRaw)) {
    if (!isRecord(rawValue)) continue
    const raw = rawValue as RawModel
    const id = text(raw.id) ?? key
    const vendorId = normalizeVendorId(id.split('/')[0] ?? key.split('/')[0] ?? 'unknown')
    const available = candidates.get(id) ?? []
    available.sort((a, b) => {
      const ownA = a.providerId === vendorId ? 0 : 1
      const ownB = b.providerId === vendorId ? 0 : 1
      if (ownA !== ownB) return ownA - ownB
      const priceA = number(a.model.cost?.output) ?? Number.POSITIVE_INFINITY
      const priceB = number(b.model.cost?.output) ?? Number.POSITIVE_INFINITY
      if (priceA !== priceB) return priceA - priceB
      return a.providerId.localeCompare(b.providerId)
    })
    const chosen = available[0]
    const rawLimit = raw.limit
    const chosenLimit = chosen?.model.limit
    const rawModalities = raw.modalities
    const chosenModalities = chosen?.model.modalities
    const providerName = providerNames.get(vendorId) ?? chosen?.providerName ?? vendorId
    records.push({
      id,
      name: text(raw.name) ?? id.split('/').pop() ?? id,
      vendorId,
      providerName,
      releaseDate: text(raw.release_date) ?? text(chosen?.model.release_date),
      knowledgeCutoff: text(raw.knowledge) ?? text(chosen?.model.knowledge),
      contextWindow: number(rawLimit?.context) ?? number(chosenLimit?.context),
      maxOutput: number(rawLimit?.output) ?? number(chosenLimit?.output),
      pricing: pricing(raw.cost ?? chosen?.model.cost),
      modalities: modalities(
        rawModalities
          ? { input: rawModalities.input, output: rawModalities.output }
          : chosenModalities
      ),
      capabilities: capabilities(raw),
      openWeights:
        typeof raw.open_weights === 'boolean'
          ? raw.open_weights
          : typeof chosen?.model.open_weights === 'boolean'
            ? chosen.model.open_weights
            : null,
      license: text(raw.license)
    })
  }

  records.sort((a, b) => a.id.localeCompare(b.id))
  return { records, providerNames }
}
