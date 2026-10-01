/**
 * OpenAI 兼容端点的流式对话客户端（手机端）。
 *
 * 与桌面端的关键差异：
 * - 桌面端把流式交给 LangChain / openai SDK；手机端不搬 LangChain，自己消费 SSE。
 * - 网络层用 `expo/fetch`（原生端已装成全局 fetch）。但这里**不直接引用全局 fetch**，
 *   而是要求调用方注入 —— 这样整套消费逻辑（增量拼接、[DONE]、错误、中止、超时）
 *   都能在 vitest 里用假响应测，不依赖真机与网络。
 *
 * 几个必须做对的细节：
 * 1. **多字节 UTF-8 不能按块解码**。中文一个字 3 字节，可能被切在两个 chunk 之间。
 *    必须用 `TextDecoder` 的 `{ stream: true }` 增量解码，否则会出现乱码字符。
 * 2. **`[DONE]` 后要中止请求**。部分网关在 DONE 之后不关闭连接，
 *    不 abort 会一直挂着，占住连接与电量。
 * 3. **超时**。RN 没有 `AbortSignal.timeout`，且 abort 与用户主动停止要能区分：
 *    靠 `timedOut` 标记判断，不靠 error 消息猜测。
 */
import { AiGatewayError, describeAiError, normalizeOpenAiBaseUrl, redactSecret } from '../shared-bridge'
import type { AiProviderId, ChatMessage } from '../shared-bridge'

import { SseParser, extractDelta, extractErrorMessage, isDoneSentinel } from './sse'
import { buildChatHeaders } from './provider-headers'

/** 注入的 fetch：签名对齐标准 fetch，便于测试替换 */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export interface StreamChatInput {
  baseUrl: string
  apiKey: string
  model: string
  provider: AiProviderId
  /** 逐轮稳定；OpenCode Go 用它做路由与 prompt 缓存，取 conversationId */
  sessionId: string
  messages: ChatMessage[]
  signal: AbortSignal
  /** 用户主动停止与超时时都会触发，用于底层资源释放 */
  onAbort?: () => void
  onDelta: (delta: string) => void
  /** 整体超时（毫秒） */
  timeoutMs: number
  temperature?: number
  fetchImpl: FetchLike
}

export interface StreamChatResult {
  /** 累积的完整正文 */
  content: string
  /** 是否收到过 [DONE] */
  completed: boolean
}

/** 构建请求体：OpenAI 兼容的 chat/completions 格式 */
export function buildChatBody(input: {
  model: string
  messages: ChatMessage[]
  temperature: number
}): string {
  return JSON.stringify({
    model: input.model,
    temperature: input.temperature,
    stream: true,
    messages: input.messages.map((message) => ({ role: message.role, content: message.content }))
  })
}

/**
 * 消费一次流式对话，把增量通过 onDelta 回调吐给调用方。
 * 正常结束返回累积正文；被中止时抛 AbortError；服务端出错时抛 AiGatewayError。
 */
export async function streamChat(input: StreamChatInput): Promise<StreamChatResult> {
  const baseUrl = normalizeOpenAiBaseUrl(input.baseUrl)
  if (!baseUrl) throw new AiGatewayError('接口地址不能为空')

  const controller = new AbortController()
  let timedOut = false

  // 手动超时：RN 不保证有 AbortSignal.timeout
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, input.timeoutMs)

  // 用户/外部中止 → 转成同一个 controller 的 abort，统一清理
  const onExternalAbort = (): void => controller.abort()
  input.signal.addEventListener('abort', onExternalAbort)
  if (input.signal.aborted) controller.abort()

  const cleanup = (): void => {
    clearTimeout(timer)
    input.signal.removeEventListener('abort', onExternalAbort)
    input.onAbort?.()
  }

  let content = ''

  try {
    // 与 abort 竞速：平台若不把 abort 传播给 fetch 本身，挂起的连接不会被超时回收
const response = await raceAbort(
      input.fetchImpl(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: buildChatHeaders({
          provider: input.provider,
          baseUrl,
          apiKey: input.apiKey,
          sessionId: input.sessionId
        }),
        body: buildChatBody({
          model: input.model,
          messages: input.messages,
          temperature: input.temperature ?? 0.7
        }),
        signal: controller.signal
      }),
      controller.signal
    )

    if (!response.ok) {
      throw new AiGatewayError(describeAiError(new Error(await readErrorDetail(response)), input.apiKey))
    }

    const body = response.body
    if (!body) throw new AiGatewayError('AI 响应为空，请重试')

    const completed = await consumeStream(body, controller.signal, (event) => {
      if (isDoneSentinel(event)) return 'done' as const

      let payload: unknown
      try {
        payload = JSON.parse(event.data)
      } catch {
        // event: error 的 data 有时不是 JSON，先单独兜一层再报格式异常
        if (event.event === 'error') {
          throw new AiGatewayError(describeAiError(new Error(redactSecret(event.data, input.apiKey))))
        }
        throw new AiGatewayError('AI 响应格式异常，请重试')
      }

      // 命中服务端错误就走错误映射，否则增量里不会带 error 字段
      const serverError =
        event.event === 'error' ? (extractErrorMessage(payload) ?? 'AI 请求失败') : extractErrorMessage(payload)
      if (serverError) {
        throw new AiGatewayError(describeAiError(new Error(serverError), input.apiKey))
      }

      const delta = extractDelta(payload)
      // 空 delta 必须跳过：首个 chunk 只有 role，末个只有 finish_reason
      if (delta) {
        content += delta
        input.onDelta(delta)
      }
      return 'next' as const
    })

    // DONE 之后主动 abort，避免服务端不关连接时一直挂着
    if (completed) controller.abort()

    if (timedOut) throw new AiGatewayError('AI 请求超时，请检查网络后重试')
    return { content, completed }
  } catch (error) {
    if (timedOut) throw new AiGatewayError('AI 请求超时，请检查网络后重试')
    if (input.signal.aborted || controller.signal.aborted) {
      // 用户主动停止：由调用方翻译成 stopped，不算错误
      throw abortError()
    }
    if (error instanceof AiGatewayError) throw error
    // RN 的网络异常文案是「Network request failed」，桌面端的映射词表覆盖不到，
    // 先归一再交给 describeAiError
    throw new AiGatewayError(describeAiError(new Error(normalizeNetworkMessage(error)), input.apiKey))
  } finally {
    cleanup()
  }
}

/** 区分「被用户/超时中止」与「服务端报错」 */
export function abortError(): Error {
  const error = new Error('aborted')
  error.name = 'AbortError'
  return error
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

/**
 * RN 的网络错误文案与 Node/undici 不同，统一成桌面端词表能识别的形式。
 * `fetch failed` 是 undici 的文案，`Network request failed` 是 RN 的。
 */
export function normalizeNetworkMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  return raw.replace(/network request failed/gi, 'fetch failed')
}

/**
 * 逐块消费 ReadableStream，按字节增量解码后喂给 SSE 解析器。
 *
 * 增量解码是关键：一个中文字符 3 字节，很可能跨 chunk 边界，
 * 直接 `TextDecoder().decode(chunk)` 会出现乱码。必须 `{ stream: true }`。
 *
 * 每次 read 都与 abort 竞速：平台未必把 fetch 的 abort 传播到 body 流上，
 * 若服务端发一半就停住，没有这层竞速会永久挂起直到超时都无法回收。
 */
async function consumeStream(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  onEvent: (event: { event: string | null; data: string }) => 'done' | 'next'
): Promise<boolean> {
  const reader = body.getReader()
  const decoder = new TextDecoder('utf-8')
  const parser = new SseParser()

  const onAbort = (): void => {
    void reader.cancel().catch(() => {
      /* 取消失败无需处理：下面会抛出 AbortError */
    })
  }
  signal.addEventListener('abort', onAbort)

  const handle = (events: ReturnType<SseParser['push']>): boolean => {
    for (const event of events) {
      if (onEvent(event) === 'done') return true
    }
    return false
  }

  try {
    for (;;) {
      const { done, value } = await raceAbort(reader.read(), signal)
      if (done) break
      if (value && handle(parser.push(decoder.decode(value, { stream: true })))) {
        return true
      }
    }
    // 收尾：部分服务端结尾不发空行，最后一段事件要靠 flush 吐出
    return handle(parser.flush())
  } finally {
    signal.removeEventListener('abort', onAbort)
    await reader.cancel().catch(() => {
      /* 已结束时 cancel 会抛，忽略即可 */
    })
  }
}

/**
 * 让 promise 与 abort 竞速：signal 中止时立即抛 AbortError，
 * 而不是等 promise 自己 settle。
 */
export function raceAbort<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    // 必须挂上处理器：原 promise 稍后若 reject 会变成 unhandled rejection
    void work.catch(() => {
      /* 已中止，原 promise 的结果不再关心 */
    })
    return Promise.reject(abortError())
  }

  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(abortError())
    signal.addEventListener('abort', onAbort, { once: true })
    work.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    )
  })
}

/** 读取错误响应体里的 message，便于命中 describeAiError 的 401/429/超时映射 */
async function readErrorDetail(response: Response): Promise<string> {
  const MAX_ERROR_BODY = 512
  try {
    const text = (await response.text()).slice(0, MAX_ERROR_BODY)
    if (!text.trim()) return ''
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>
      const detail = extractErrorMessage(parsed)
      if (detail) return detail
    } catch {
      /* 非 JSON 错误体（如 HTML 页面）直接截断原文 */
    }
    return text.replace(/\s+/g, ' ').trim()
  } catch {
    return ''
  }
}
