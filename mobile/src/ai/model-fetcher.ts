/**
 * 拉取供应商模型列表（手机端）—— 与桌面端 `SettingsService.fetchModels` 语义一致。
 *
 * 复用桌面端的 `extractModelIds`（纯解析，无 Node 依赖），但**不复用** `fetchModelIds`：
 * 桌面端那份用了 `AbortSignal.timeout`，RN 不保证有这个 API。
 */
import {
  AiGatewayError,
  describeAiError,
  extractModelIds,
  findAiProvider,
  normalizeOpenAiBaseUrl
} from '../shared-bridge'
import type { AiFetchModelsInput, AiModelListResult, AiProviderId } from '../shared-bridge'

import type { AiSettingsService } from './ai-settings'
import type { FetchLike } from './stream-chat'
import { buildModelListHeaders } from './provider-headers'

/** 拉取模型列表的超时：设置页需要快速反馈，不宜等同对话超时 */
const MODELS_TIMEOUT_MS = 20_000

export async function fetchModels(
  settings: AiSettingsService,
  input: AiFetchModelsInput,
  fetchImpl: FetchLike
): Promise<AiModelListResult> {
  const baseUrl = normalizeOpenAiBaseUrl(input.baseUrl)
  if (!baseUrl) throw new AiGatewayError('请先填写接口地址')

  // Key 优先用输入的，留空则回落到指定档案（缺省为启用档案）已保存的 Key
  const apiKey = input.apiKey?.trim() || (await settings.apiKeyForProfile(input.profileId))
  if (!apiKey) throw new AiGatewayError('请先填写或保存 API Key')

  try {
    const models = await fetchModelIds({
      baseUrl,
      apiKey,
      provider: input.provider,
      profileId: input.profileId,
      fetchImpl
    })
    return { models, source: 'remote' }
  } catch (error) {
    // 自定义供应商没有内置推荐列表，直接抛错；其余降级为预设列表
    const preset = findAiProvider(input.provider)
    if (preset.models.length === 0) throw error

    const reason = error instanceof Error ? error.message : '未知原因'
    return {
      models: [...preset.models],
      source: 'preset',
      message: `未能连接供应商接口（${reason}），已列出内置推荐模型`
    }
  }
}

interface FetchModelIdsInput {
  baseUrl: string
  apiKey: string
  provider: AiProviderId
  profileId?: string
  fetchImpl: FetchLike
}

export async function fetchModelIds(input: FetchModelIdsInput): Promise<string[]> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), MODELS_TIMEOUT_MS)

  try {
    const response = await input.fetchImpl(`${input.baseUrl}/models`, {
      method: 'GET',
      headers: buildModelListHeaders({
        provider: input.provider,
        baseUrl: input.baseUrl,
        apiKey: input.apiKey,
        sessionId: input.profileId ?? 'tool-box-model-list'
      }),
      signal: controller.signal
    })

    if (!response.ok) {
      const detail = await readErrorDetail(response)
      const raw = detail ? `HTTP ${response.status} ${detail}` : `HTTP ${response.status}`
      throw new AiGatewayError(describeAiError(new Error(raw), input.apiKey))
    }

    const models = extractModelIds(await response.json())
    if (models.length === 0) throw new AiGatewayError('供应商没有返回可用模型')
    return models
  } catch (error) {
    if (error instanceof AiGatewayError) throw error
    if (controller.signal.aborted) throw new AiGatewayError('连接模型列表超时')
    throw new AiGatewayError(describeAiError(new Error(normalizeNetworkMessage(error)), input.apiKey))
  } finally {
    clearTimeout(timer)
  }
}

/** 读取错误响应体里的 message，便于命中 describeAiError 的 401/429/超时映射 */
async function readErrorDetail(response: Response): Promise<string> {
  const MAX_ERROR_BODY = 512
  try {
    const text = (await response.text()).slice(0, MAX_ERROR_BODY)
    if (!text.trim()) return ''
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>
      const error = parsed['error']
      if (typeof error === 'string') return error
      if (typeof error === 'object' && error !== null) {
        const message = (error as Record<string, unknown>)['message']
        if (typeof message === 'string') return message
      }
      const message = parsed['message']
      if (typeof message === 'string') return message
    } catch {
      /* 非 JSON 错误体（如 HTML 页面）直接截断原文 */
    }
    return text.replace(/\s+/g, ' ').trim()
  } catch {
    return ''
  }
}

function normalizeNetworkMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  return raw.replace(/network request failed/gi, 'fetch failed')
}