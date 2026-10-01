import { AiGatewayError, describeAiError, normalizeOpenAiBaseUrl } from './errors'

/** 拉取模型列表的超时时间：设置页需快速反馈，不宜等同对话超时 */
const MODELS_TIMEOUT_MS = 20_000
/** 单次最多接收的模型数量，避免异常响应撑爆下拉框 */
const MAX_MODELS = 300
/** 错误响应体最多读取长度，避免读取超大 body */
const MAX_ERROR_BODY = 512

export interface FetchModelIdsInput {
  baseUrl: string
  apiKey: string
  /** 供应商要求的额外请求头（如 OpenCode Go 的会话 ID） */
  headers?: Record<string, string>
}

/**
 * 调用 OpenAI 兼容的 `GET {baseUrl}/models` 拉取可用模型列表。
 * 鉴权统一用 `Authorization: Bearer`，各家 OpenAI 兼容端点均支持。
 * 任何失败都转成 AiGatewayError，且错误文案经 describeAiError 脱敏（不会带出 Key）。
 */
export async function fetchModelIds(input: FetchModelIdsInput): Promise<string[]> {
  const baseUrl = normalizeOpenAiBaseUrl(input.baseUrl)
  if (!baseUrl) throw new AiGatewayError('接口地址不能为空')

  let response: Response
  try {
    response = await fetch(`${baseUrl}/models`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...input.headers
      },
      signal: AbortSignal.timeout(MODELS_TIMEOUT_MS)
    })
  } catch (error) {
    throw new AiGatewayError(describeAiError(error, input.apiKey), error)
  }

  if (!response.ok) {
    const detail = await readErrorDetail(response)
    const raw = detail ? `HTTP ${response.status} ${detail}` : `HTTP ${response.status}`
    throw new AiGatewayError(describeAiError(new Error(raw), input.apiKey))
  }

  let payload: unknown
  try {
    payload = await response.json()
  } catch (error) {
    throw new AiGatewayError('模型列表响应不是合法 JSON', error)
  }

  const models = extractModelIds(payload)
  if (models.length === 0) throw new AiGatewayError('未获取到任何模型')
  return models
}

/**
 * 兼容三种常见返回结构：
 * - OpenAI：`{ data: [{ id }] }`
 * - Gemini 风格：`{ models: [{ name | id }] }`（`models/gemini-x` 去掉前缀）
 * - 裸数组：`["model-a"]`
 * 结果去重、去掉空值、字典序排序后截断。
 */
export function extractModelIds(payload: unknown): string[] {
  const source = pickModelArray(payload)
  if (!source) return []

  const ids = new Set<string>()
  for (const item of source.slice(0, MAX_MODELS * 2)) {
    const id = readModelId(item)
    if (id) ids.add(id)
    if (ids.size >= MAX_MODELS) break
  }
  return [...ids].sort((a, b) => a.localeCompare(b))
}

function pickModelArray(payload: unknown): unknown[] | null {
  if (Array.isArray(payload)) return payload
  if (typeof payload !== 'object' || payload === null) return null

  const record = payload as Record<string, unknown>
  if (Array.isArray(record.data)) return record.data
  if (Array.isArray(record.models)) return record.models
  return null
}

function readModelId(item: unknown): string {
  if (typeof item === 'string') return normalizeModelId(item)
  if (typeof item !== 'object' || item === null) return ''

  const record = item as Record<string, unknown>
  for (const key of ['id', 'name', 'model']) {
    const value = record[key]
    if (typeof value === 'string') {
      const normalized = normalizeModelId(value)
      if (normalized) return normalized
    }
  }
  return ''
}

function normalizeModelId(value: string): string {
  return value.trim().replace(/^models\//, '').slice(0, 80)
}

/** 读取错误响应体里的 message 字段，便于命中 describeAiError 的错误映射 */
async function readErrorDetail(response: Response): Promise<string> {
  try {
    const text = (await response.text()).slice(0, MAX_ERROR_BODY)
    if (!text.trim()) return ''
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>
      const error = parsed.error
      if (typeof error === 'string') return error
      if (typeof error === 'object' && error !== null) {
        const message = (error as Record<string, unknown>).message
        if (typeof message === 'string') return message
      }
      if (typeof parsed.message === 'string') return parsed.message
    } catch {
      /* 非 JSON 错误体（如 HTML 页面）直接截断原文 */
    }
    return text.replace(/\s+/g, ' ').trim()
  } catch {
    return ''
  }
}
