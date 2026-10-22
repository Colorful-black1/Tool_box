/**
 * AI 网关（手机端）—— 流式对话语义与桌面端 `AiGateway` 对齐，
 * 另加一个不落库的无会话流式 `complete()` 供密码箱 AI 识别使用。
 *
 * 关键语义（与桌面端一致，改动会让两端行为分叉）：
 * 1. `active` 以 conversationId 为键，**同一会话同时只允许一个流**，
 *    重复 send 直接报错。
 * 2. `send()` 先把 user 消息落库再返回，流在后台跑，不等生成结束。
 * 3. **顺序**：append user → 自动标题 → 读历史。所以发给模型的历史必然含本轮消息。
 * 4. 用户主动停止 → `onStopped`，**不算错误**；其他失败 → `onError`（文案已脱敏）。
 * 5. 无论成败都必须从 `active` 里清理，否则该会话再也发不出消息。
 * 6. 只有成功路径才落库 assistant 消息；停止时已收到的增量丢弃。
 *
 * 对话本身由 `agent/agent-loop.ts` 的模型 ⇄ 工具循环承担（桌面端是 LangChain Agent）：
 * 这里只负责落库、事件回推、权限档位读取与取消语义。
 */
import { AiGatewayError, validateChatInput } from '../shared-bridge'
import type {
  AgentToolApprovalInput,
  AgentToolApprovalRequestEvent,
  AgentToolCallEvent,
  AgentToolResultEvent,
  AiProviderId,
  ChatMessage,
  ConversationSummary
} from '../shared-bridge'
import { trimHistory, trimmedHistoryNotice } from '../shared-bridge'

import { runAgent } from '../agent/agent-loop'
import { ApprovalGate } from '../agent/approval-gate'
import { getAgentPermission } from '../agent/permission'
import { AGENT_SYSTEM_PROMPT } from '../agent/system-prompt'
import { createAgentToolSet } from '../agent/tools'
import type { AgentToolDefinition } from '../agent/tool-registry'
import { CHAT_TIMEOUT_MS, CONVERSATION_TITLE_MAX_CHARS, DEFAULT_CONVERSATION_TITLE, MAX_HISTORY_CHARS } from '../data/constants'
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
  /** 工具开始执行（已获批准或无需批准） */
  onToolCall(event: AgentToolCallEvent): void
  /** 工具执行结束 */
  onToolResult(event: AgentToolResultEvent): void
  /** 写工具请求批准（界面弹出审批卡） */
  onToolApprovalRequest(event: AgentToolApprovalRequestEvent): void
  /** 非错误提示，例如「当前模型不支持工具调用，已降级为普通对话」 */
  onNotice?(message: string): void
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

/**
 * 工具调用的 callId。
 *
 * 它只是「界面上的工具卡片 ↔ 审批回执」的配对键，**不是凭据**，
 * 因此用 `Date.now` + `Math.random` 即可（同 `newOneShotSessionId`）——
 * 这样本模块不必引 `expo-crypto`，可以在 vitest 的 node 环境里直接跑。
 */
function newCallId(): string {
  return `call-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export class AiGateway {
  /** 运行期流句柄：key 是会话 id，value 是用于中止的控制器 */
  private readonly active = new Map<string, AbortController>()
  /** 写工具的审批门：跨轮次存在，因为工具节点会挂起等用户回执 */
  private readonly gate = new ApprovalGate()
  /** 工具声明是纯数据，构造一次即可（handler 里再按会话注入上下文） */
  private readonly tools: AgentToolDefinition[]

  constructor(
    private readonly settings: AiSettingsService,
    private readonly store: MobileStore,
    private readonly fetchImpl: FetchLike,
    private readonly timeoutMs: number = CHAT_TIMEOUT_MS
  ) {
    this.tools = createAgentToolSet({ store })
  }

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
    // 只携带预算内的最近若干轮；更早的内容在提示词里明说没带上
    const history = trimHistory(await this.store.listMessages(conversationId), MAX_HISTORY_CHARS)

    const controller = new AbortController()
    this.active.set(conversationId, controller)

    void this.runAgentTurn({
      conversationId,
      history: history.kept,
      dropped: history.dropped,
      config,
      controller,
      sink
    })

    return { userMessage, conversation: updated }
  }

  /** 用户主动停止：只中止，不发事件，由 runAgentTurn 判定后转成 stopped */
  stop(conversationId: string): void {
    this.active.get(conversationId)?.abort()
    // 立刻拒绝该会话挂起的审批，否则工具节点会一直等着用户回执
    this.gate.rejectConversation(conversationId)
  }

  /** 界面对写工具审批的回执 */
  approveTool(input: AgentToolApprovalInput): void {
    this.gate.settle(input.callId, input.approved === true)
  }

  /**
   * 界面离开会话时调用：拒绝该会话挂起的审批，但**不打断生成**。
   *
   * 与 `stop()` 的区别：审批卡随页面一起消失，用户再也点不到「允许 / 拒绝」，
   * 不主动 settle 的话工具节点会永远挂着，该会话的流也永远不结束。
   * 此处只拒绝挂起项，让模型接着把话说完（生成中的正文不受影响）。
   */
  cancelApprovals(conversationId: string): void {
    this.gate.rejectConversation(conversationId)
  }

  /**
   * 无会话流式调用，供密码箱「AI 识别」使用，增量仅回推给调用方。
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
    onDelta?: (delta: string) => void
  }): Promise<string> {
    const config = await this.settings.getActiveConfig()

    // 外部 signal 与内部 controller 串一层：streamChat 内部还会再包一层超时，
    // 这里只负责把调用方的取消意图透进去。
    const controller = new AbortController()
    const onExternalAbort = (): void => controller.abort()
    input.signal?.addEventListener('abort', onExternalAbort)
    if (input.signal?.aborted) controller.abort()

    try {
      let received = 0
      const result = await streamChat({
        baseUrl: config.baseUrl,
        apiKey: config.apiKey,
        model: config.model,
        provider: config.provider,
        sessionId: input.sessionId ?? newOneShotSessionId(),
        messages: [
          ...(input.system ? [{ role: 'system' as const, content: input.system }] : []),
          { role: 'user' as const, content: validateChatInput(input.prompt) }
        ],
        onDelta: (delta) => {
          received += delta.length
          if (received > 200_000) throw new AiGatewayError('AI 输出过长，请拆分后重试')
          input.onDelta?.(delta)
        },
        signal: controller.signal,
        timeoutMs: input.timeoutMs ?? COMPLETE_TIMEOUT_MS,
        temperature: input.temperature ?? 0.2,
        fetchImpl: this.fetchImpl
      })
      if (!result.content.trim()) throw new AiGatewayError('AI 未返回内容')
      return result.content
    } finally {
      input.signal?.removeEventListener('abort', onExternalAbort)
    }
  }

  private async runAgentTurn(input: {
    conversationId: string
    history: ChatMessage[]
    dropped: number
    config: { provider: AiProviderId; baseUrl: string; model: string; apiKey: string }
    controller: AbortController
    sink: ChatEventSink
  }): Promise<void> {
    const { conversationId, history, dropped, config, controller, sink } = input

    try {
      // 每轮都现读权限：用户可能在生成过程中切了档位，下一轮就该生效
      const permission = await getAgentPermission(this.store)

      const result = await runAgent({
        conversationId,
        history,
        config,
        systemPrompt:
          dropped > 0
            ? `${AGENT_SYSTEM_PROMPT}\n\n${trimmedHistoryNotice(dropped)}`
            : AGENT_SYSTEM_PROMPT,
        permission,
        tools: this.tools,
        gate: this.gate,
        sink: {
          onToolCall: (event) => sink.onToolCall({ conversationId, ...event }),
          onToolResult: (event) => sink.onToolResult({ conversationId, ...event }),
          onToolApprovalRequest: (event) =>
            sink.onToolApprovalRequest({ conversationId, ...event })
        },
        onDelta: (delta) => sink.onDelta({ conversationId, delta }),
        onNotice: (message) => sink.onNotice?.(message),
        signal: controller.signal,
        fetchImpl: this.fetchImpl,
        timeoutMs: this.timeoutMs,
        idFactory: newCallId
      })

      // 用户主动停止时 runAgent 会抛 AbortError，走下面的 stopped 分支，不落库。
      // 只调了工具没说话时给一句兜底，否则会以「AI 未返回内容」收场（与桌面端一致）。
      const content = result.content.trim()
        ? result.content
        : result.usedTools
          ? '已完成操作。'
          : ''
      if (!content.trim()) throw new AiGatewayError('AI 未返回内容')

      const message = await this.store.appendMessage({
        conversationId,
        role: 'assistant',
        content
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
      // 正常结束也要拒一次：模型可能留下没人回应的审批（例如步数超限退出）
      this.gate.rejectConversation(conversationId)
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
