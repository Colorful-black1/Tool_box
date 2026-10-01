/**
 * 流式对话网关（手机端）—— 语义与桌面端 `AiGateway` 对齐。
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