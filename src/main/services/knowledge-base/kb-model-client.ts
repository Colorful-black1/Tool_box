import {
  CLIENT_USER_AGENT,
  buildProviderHeaders,
  requiresCustomUserAgent
} from '../ai-gateway/provider-headers'
import type { KbAiEndpointConfig } from '../settings/settings-service'

/**
 * 知识库的向量 / 重排请求：直接走 OpenAI 兼容的 `/embeddings` 与 `/rerank`。
 *
 * 不引入 SDK：两个接口都是单次 JSON 请求，手写反而更容易控制超时、
 * 错误脱敏与测试注入。任何失败都抛 `KbModelError`，由检索层降级为关键词。
 */

const REQUEST_TIMEOUT_MS = 60_000
/** 常见向量维度上限；超出视为供应商返回异常。 */
const MAX_EMBEDDING_DIM = 8192
/** 单次请求的最大文本条数，防止误传整库。 */
const MAX_EMBEDDING_INPUTS = 64
const SESSION_ID = 'tool-box-knowledge-base'

export class KbModelError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause })
    this.name = 'KbModelError'
  }
}

export interface KbModelRequestOptions {
  fetchImpl?: typeof fetch
  signal?: AbortSignal
}

/**
 * 批量取向量；返回顺序与入参一致。
 * 只接受 `{ data: [{ embedding, index? }] }`，条数或维度不一致直接报错。
 */
export async function requestEmbeddings(
  config: KbAiEndpointConfig,
  texts: readonly string[],
  options: KbModelRequestOptions = {}
): Promise<Float32Array[]> {
  if (texts.length === 0) return []
  if (texts.length > MAX_EMBEDDING_INPUTS) {
    throw new KbModelError(`单批向量化最多 ${MAX_EMBEDDING_INPUTS} 段`)
  }

  const json = await postJson(
    config,
    '/embeddings',
    { model: config.model, input: texts },
    '向量',
    options
  )
  const data = Array.isArray(json.data) ? json.data : null
  if (!data || data.length !== texts.length) {
    throw new KbModelError('向量服务返回的条数与请求不一致')
  }

  const slots: Array<Record<string, unknown> | null> = new Array(texts.length).fill(null)
  for (let position = 0; position < data.length; position += 1) {
    const item = data[position]
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new KbModelError('向量服务返回格式不正确')
    }
    const record = item as Record<string, unknown>
    const index =
      typeof record.index === 'number' && Number.isInteger(record.index)
        ? record.index
        : position
    if (index < 0 || index >= texts.length || slots[index]) {
      throw new KbModelError('向量服务返回的下标无效')
    }
    slots[index] = record
  }

  const vectors: Float32Array[] = []
  let dimension = 0
  for (const slot of slots) {
    if (!slot) throw new KbModelError('向量服务返回的条数与请求不一致')
    const embedding = slot.embedding
    if (!Array.isArray(embedding) || embedding.length === 0) {
      throw new KbModelError('向量服务未返回有效的向量')
    }
    if (embedding.length > MAX_EMBEDDING_DIM) {
      throw new KbModelError('向量维度超出上限')
    }
    if (dimension === 0) dimension = embedding.length
    if (embedding.length !== dimension) throw new KbModelError('同一批向量维度不一致')
    const vector = new Float32Array(embedding.length)
    for (let index = 0; index < embedding.length; index += 1) {
      const value = embedding[index]
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new KbModelError('向量中包含无效数值')
      }
      vector[index] = value
    }
    vectors.push(vector)
  }
  return vectors
}

/**
 * 重排：返回与 documents 对齐的分数，未返回的条目为 `-Infinity`。
 * 兼容 `{ results: [{ index, relevance_score }] }` 与 `{ data: [...] }` 两种响应。
 */
export async function requestRerank(
  config: KbAiEndpointConfig,
  query: string,
  documents: readonly string[],
  options: KbModelRequestOptions = {}
): Promise<number[]> {
  if (documents.length === 0) return []
  const json = await postJson(
    config,
    '/rerank',
    { model: config.model, query, documents, top_n: documents.length },
    '重排',
    options
  )
  const results = Array.isArray(json.results)
    ? json.results
    : Array.isArray(json.data)
      ? json.data
      : null
  if (!results) throw new KbModelError('重排服务返回格式不正确')

  const scores: number[] = new Array(documents.length).fill(Number.NEGATIVE_INFINITY)
  for (const item of results) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const record = item as Record<string, unknown>
    const index = Number(record.index)
    const rawScore = record.relevance_score ?? record.score
    const score = Number(rawScore)
    if (!Number.isInteger(index) || index < 0 || index >= documents.length) continue
    if (!Number.isFinite(score)) continue
    scores[index] = Math.max(scores[index], score)
  }
  if (scores.every((score) => score === Number.NEGATIVE_INFINITY)) {
    throw new KbModelError('重排服务未返回有效分数')
  }
  return scores
}

async function postJson(
  config: KbAiEndpointConfig,
  path: string,
  body: unknown,
  label: string,
  options: KbModelRequestOptions
): Promise<Record<string, unknown>> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  if (typeof fetchImpl !== 'function') {
    throw new KbModelError(`${label}服务不可用：当前运行环境没有 fetch`)
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  const forwardAbort = (): void => controller.abort()
  options.signal?.addEventListener('abort', forwardAbort)
  if (options.signal?.aborted) controller.abort()

  const input = { provider: config.provider, baseUrl: config.baseUrl, sessionId: SESSION_ID }
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${config.apiKey}`,
    ...buildProviderHeaders(input),
    ...(requiresCustomUserAgent(input) ? { 'User-Agent': CLIENT_USER_AGENT } : {})
  }

  try {
    const response = await fetchImpl(`${config.baseUrl}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal
    })
    if (!response.ok) {
      throw new KbModelError(
        `${label}服务返回 HTTP ${response.status}${statusHint(response.status, path)}`
      )
    }
    const raw = await response.text()
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      throw new KbModelError(`${label}服务返回了无法解析的内容`)
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new KbModelError(`${label}服务返回格式不正确`)
    }
    return parsed as Record<string, unknown>
  } catch (error) {
    if (error instanceof KbModelError) throw error
    if (controller.signal.aborted) {
      throw new KbModelError(`${label}请求超时，已降级`)
    }
    throw new KbModelError(`${label}服务连接失败，请检查接口地址与网络`, error)
  } finally {
    clearTimeout(timer)
    options.signal?.removeEventListener('abort', forwardAbort)
  }
}

function statusHint(status: number, path: string): string {
  if (status === 401 || status === 403) return '，请检查 API Key'
  if (status === 404) return `，该服务可能不支持 ${path}`
  if (status === 429) return '，请求过于频繁'
  if (status >= 500) return '，服务暂时不可用'
  return ''
}
