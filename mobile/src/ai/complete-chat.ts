/**
 * OpenAI 兼容端点的**非流式**一次性补全（手机端）。
 *
 * 为什么单独写而不在 `stream-chat.ts` 里加个开关：
 * 密码箱的「AI 识别」要把整段文本丢给模型、拿一整段 JSON 回来，
 * 逐字吐字对用户没有意义；而流式路径的核心复杂度（SSE 增量解码、
 * `[DONE]` 后 abort、增量跨 chunk 的多字节字符）在这里一个都用不上。
 * 强行合并会让流式那条更敏感的链路背上无关分支。
 *
 * 仍然只消费 `choices[0].message.content`，与 `sse.ts` 的
 * `extractMessageContent` 共用解析器，保证流式与非流式对「正文在哪」的
 * 判断不会漂移（含 content 为 block 数组的兼容形态）。
 */
import { AiGatewayError, describeAiError, normalizeOpenAiBaseUrl } from '../shared-bridge'
import type { AiProviderId } from '../shared-bridge'

import { buildJsonHeaders } from './provider-headers'
import type { FetchLike } from './stream-chat'
import { extractErrorMessage, extractMessageContent } from './sse'
import { normalizeNetworkMessage, raceAbort, readErrorDetail } from './stream-chat'

export interface CompleteChatInput {
  baseUrl: string
  apiKey: string
  model: string
  provider: AiProviderId
  /** 单次调用内稳定即可；OpenCode Go 用它做路由，取一次性 id 也能过 */
  sessionId: string
  /** 系统提示词，可选 */
  system?: string
  /** 用户提示词 */
  prompt: string
  signal: AbortSignal
  /** 整体超时（毫秒） */
  timeoutMs: number
  temperature?: number
  fetchImpl: FetchLike
}

/** 构建请求体：`stream: false` 拿完整 JSON */
export function buildCompletionBody(input: {
  model: string
  system?: string
  prompt: string
  temperature: number
}): string {
  const messages = [
    ...(input.system ? [{ role: 'system' as const, content: input.system }] : []),
    { role: 'user' as const, content: input.prompt }
  ]
  return JSON.stringify({
    model: input.model,
    temperature: input.temperature,
    stream: false,
    messages
  })
}

/**
 * 一次性拿到模型回复全文。
 * 中止时抛 AbortError（由调用方翻译成「已取消」），其余失败一律 AiGatewayError。
 */
export async function completeChat(input: CompleteChatInput): Promise<string> {
  const baseUrl = normalizeOpenAiBaseUrl(input.baseUrl)
  if (!baseUrl) throw new AiGatewayError('接口地址不能为空')
  if (!input.prompt.trim()) throw new AiGatewayError('输入内容不能为空')

  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, input.timeoutMs)

  const onExternalAbort = (): void => controller.abort()
  input.signal.addEventListener('abort', onExternalAbort)
  if (input.signal.aborted) controller.abort()

  try {
    const response = await raceAbort(
      input.fetchImpl(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: buildJsonHeaders({
          provider: input.provider,
          baseUrl,
          apiKey: input.apiKey,
          sessionId: input.sessionId
        }),
        body: buildCompletionBody({
          model: input.model,
          system: input.system,
          prompt: input.prompt,
          temperature: input.temperature ?? 0.2
        }),
        signal: controller.signal
      }),
      controller.signal
    )

    if (!response.ok) {
      throw new AiGatewayError(describeAiError(new Error(await readErrorDetail(response)), input.apiKey))
    }

    const raw = await response.text()
    let payload: unknown
    try {
      payload = JSON.parse(raw)
    } catch {
      throw new AiGatewayError('AI 响应格式异常，请重试')
    }

    // 2xx 但正文里带 error 的网关不少见，必须先查错误再取正文
    const serverError = extractErrorMessage(payload)
    if (serverError) {
      throw new AiGatewayError(describeAiError(new Error(serverError), input.apiKey))
    }

    if (timedOut) throw new AiGatewayError('AI 请求超时，请检查网络后重试')

    const content = extractMessageContent(payload)
    if (!content.trim()) throw new AiGatewayError('AI 未返回内容')
    return content
  } catch (error) {
    if (timedOut) throw new AiGatewayError('AI 请求超时，请检查网络后重试')
    if (input.signal.aborted || controller.signal.aborted) {
      // 用户主动取消：由调用方决定怎么提示，这里保持「中止」语义
      const aborted = new Error('aborted')
      aborted.name = 'AbortError'
      throw aborted
    }
    if (error instanceof AiGatewayError) throw error
    throw new AiGatewayError(describeAiError(new Error(normalizeNetworkMessage(error)), input.apiKey))
  } finally {
    clearTimeout(timer)
    input.signal.removeEventListener('abort', onExternalAbort)
  }
}
