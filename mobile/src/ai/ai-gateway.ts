/**
 * AI 网关（手机端）—— 流式对话语义与桌面端 `AiGateway` 对齐，
 * 另加一个不落库的非流式 `complete()` 供密码箱 AI 识别使用。
 *
 * 关键语义（与桌面端一致，改动会让两端行为分叉）：
 * 1. `active` 以 conversationId 为键，**同一会话同时只允许一个流**，
 *    重复 send 直接报错。
 * 2. `send()` 先把 user 消息落库再返回，流在后台跑，不等生成结束。
 * 3. **顺序**：append user → 自动标题 → 读历史。所以发给模型的历史必然含本轮消息。
 * 4. 用户主动停止 → `onStopped`，**不算错误**；其他失败 → `onError`（文案已脱敏）。
 * 5. 无论成败都必须从 `active` 里清理，否则该会话再也发不出消息。
 * 6. 只有成功路径才落库 assistant 消息；停止时已收到的增量丢弃。
 */
import { AiGatewayError, validateChatInput } from '../shared-bridge'
import type { AiProviderId, ChatMessage, ConversationSummary } from '../shared-bridge'

import { CHAT_TIMEOUT_MS, CONVERSATION_TITLE_MAX_CHARS, DEFAULT_CONVERSATION_TITLE } from '../data/constants'
import type { MobileStore } from '../data/store'

import type { AiSettingsService } from './ai-settings'
import { completeChat } from './complete-chat'
import { isAbortError, streamChat } from './stream-chat'
import type { FetchLike } from './stream-chat'

export interface ChatEventSink {
  onDelta(event: { conversationId: string; delta: string }): void
  onCompleted(event: {
    conversationId: string
    message: ChatMessage
    conversation: ConversationSummary
  }): void
  onError(event: { conversationId: string; message: string }): void
  onStopped(event: { conversationId: string }): void
}

export interface ChatSendResult {
  userMessage: ChatMessage
  conversation: ConversationSummary
}

/** 一次性补全（AI 识别）的超时，比对话短：用户站在弹窗前干等不宜过久 */
const COMPLETE_TIMEOUT_MS = 45_000

/**
 * 一次性调用的会话 id。
 *
 * OpenCode Go 强校验 `x-opencode-session`，但它只是路由 / prompt 缓存的键，
 * **不是凭据**，因此这里用 `Math.random` 生成即可 —— 不需要 crypto 随机数，
 * 也就不必把 `expo-crypto` 引进这个纯逻辑模块（本文件要在 vitest 的 node 环境跑）。
 * 对话链路仍然用 conversationId，那条必须逐轮稳定，另走 `send`。
 */
function newOneShotSessionId(): string {
  return `oneshot-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export class AiGateway {
  /** 运行期流句柄：key 是会话 id，value 是用于中止的控制器 */
  private readonly active = new Map<string, AbortController>()

  constructor(
    private readonly settings: AiSettingsService,
    private readonly store: MobileStore,
    private readonly fetchImpl: FetchLike,
    private readonly timeoutMs: number = CHAT_TIMEOUT_MS
  ) {}

  /** 该会话是否正在生成回复，用于界面禁用输入 */
  isStreaming(conversationId: string): boolean {
    return this.active.has(conversationId)
  }

  /**
   * 发消息：先落库 user 消息并立即返回，流在后台消费。
   * 返回时 assistant 回复还没开始，界面靠 onDelta/onCompleted 推进。
   */
  async send(conversationId: string, content: string, sink: ChatEventSink): Promise<ChatSendResult> {
    if (this.active.has(conversationId)) {
      throw new AiGatewayError('该会话正在生成回复，请先停止或稍候')
    }

    const trimmed = validateChatInput(content)
    const conversation = await this.requireConversation(conversationId)
    const config = await this.settings.getActiveConfig()

    const userMessage = await this.store.appendMessage({
      conversationId,
      role: 'user',
      content: trimmed
    })

    const updated = await this.autoTitle(conversation, trimmed)
    const history = await this.store.listMessages(conversationId)

    const controller = new AbortController()
    this.active.set(conversationId, controller)

    void this.runStream({
      conversationId,
      history,
      config,
      controller,
      sink
    })

    return { userMessage, conversation: updated }
  }

  /** 用户主动停止：只中止，不发事件，由 runStream 判定后转成 stopped */
  stop(conversationId: string): void {
    this.active.get(conversationId)?.abort()
  }

  /**
   * 非流式一次性调用，供密码箱「AI 识别」使用。
   *
   * 与 `send` 的边界（刻意不同，别混用）：
   * - **不落库**：识别结果是临时的草稿，用户确认前不该进 messages 表；
   * - **不进 active 表**：它不属于任何会话，不该占用会话级并发名额，
   *   否则同一会话正在流式时点识别会被误判成「正在生成回复」；
   * - **不走 autoTitle / 历史**：它不是对话，没有上下文。
   *
   * 超时单独给一个更短的默认值：识别是一次性往返，用户在弹窗前干等着，
   * 顶着 120s 的对话超时体验很差。
   */
  async complete(input: {
    prompt: string
    system?: string
    temperature?: number
    signal?: AbortSignal
    sessionId?: string
    timeoutMs?: number
  }): Promise<string> {
    const config = await this.settings.getActiveConfig()

    // 外部 signal 与内部 controller 串一层：completeChat 内部还会再包一层超时，
    // 这里只负责把调用方的取消意图透进去。
    const controller = new AbortController()
    const onExternalAbort = (): void => controller.abort()
    input.signal?.addEventListener('abort', onExternalAbort)
    if (input.signal?.aborted) controller.abort()

    try {
      return await completeChat({
        baseUrl: config.baseUrl,
        apiKey: config.apiKey,
        model: config.model,
        provider: config.provider,
        sessionId: input.sessionId ?? newOneShotSessionId(),
        system: input.system,
        prompt: input.prompt,
        signal: controller.signal,
        timeoutMs: input.timeoutMs ?? COMPLETE_TIMEOUT_MS,
        temperature: input.temperature,
        fetchImpl: this.fetchImpl
      })
    } finally {
      input.signal?.removeEventListener('abort', onExternalAbort)
    }
  }

  private async runStream(input: {
    conversationId: string
    history: ChatMessage[]
    config: { provider: AiProviderId; baseUrl: string; model: string; apiKey: string }
    controller: AbortController
    sink: ChatEventSink
  }): Promise<void> {
    const { conversationId, history, config, controller, sink } = input

    try {
      const result = await streamChat({
        baseUrl: config.baseUrl,
        apiKey: config.apiKey,
        model: config.model,
        // 会话 id 逐轮稳定；OpenCode Go 依赖它做路由与 prompt 缓存
        provider: config.provider,
        sessionId: conversationId,
        messages: history,
        signal: controller.signal,
        timeoutMs: this.timeoutMs,
        fetchImpl: this.fetchImpl,
        onDelta: (delta) => sink.onDelta({ conversationId, delta })
      })

      // 用户主动停止时 streamChat 会抛 AbortError，走下面的 stopped 分支，不落库
      if (!result.content.trim()) throw new AiGatewayError('AI 未返回内容')

      const message = await this.store.appendMessage({
        conversationId,
        role: 'assistant',
        content: result.content
      })
      const conversation = await this.store.getConversation(conversationId)
      if (!conversation) throw new AiGatewayError('会话不存在')

      sink.onCompleted({ conversationId, message, conversation })
    } catch (error) {
      // 主动停止不算错误；已收到的增量按桌面端语义丢弃，不落库 assistant 消息
      if (controller.signal.aborted || isAbortError(error)) {
        sink.onStopped({ conversationId })
        return
      }
      sink.onError({
        conversationId,
        message: error instanceof Error ? error.message : 'AI 请求失败'
      })
    } finally {
      this.active.delete(conversationId)
    }
  }

  /** 首次对话用内容当标题；已有标题不动 */
  private async autoTitle(
    conversation: ConversationSummary,
    content: string
  ): Promise<ConversationSummary> {
    if (conversation.title !== DEFAULT_CONVERSATION_TITLE) return conversation

    const title =
      content.replace(/\s+/g, ' ').trim().slice(0, CONVERSATION_TITLE_MAX_CHARS) ||
      DEFAULT_CONVERSATION_TITLE
    return this.store.renameConversation(conversation.id, title)
  }

  private async requireConversation(conversationId: string): Promise<ConversationSummary> {
    const conversation = await this.store.getConversation(conversationId)
    if (!conversation) throw new AiGatewayError('会话不存在')
    return conversation
  }
}