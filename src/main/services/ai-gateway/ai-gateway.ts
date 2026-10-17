import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import { ChatOpenAI } from '@langchain/openai'

import {
  CHAT_TIMEOUT_MS,
  CONVERSATION_TITLE_MAX_CHARS,
  DEFAULT_CONVERSATION_TITLE
} from '../../../shared/constants'
import type {
  AgentPermission,
  AgentToolApprovalInput,
  AgentToolApprovalRequestEvent,
  AgentToolCallEvent,
  AgentToolResultEvent,
  AiConfig,
  ChatCompletedEvent,
  ChatDeltaEvent,
  ChatErrorEvent,
  ChatMessage,
  ChatSendRequest,
  ChatSendResult,
  ChatStoppedEvent,
  ConversationSummary
} from '../../../shared/types'
import { DEFAULT_AGENT_PERMISSION, isAgentPermission } from '../../../shared/types'
import { ApprovalGate } from '../agent/approval-gate'
import { runAgent } from '../agent/agent-runner'
import { createAgentToolSet } from '../agent/tools'
import type { ImportService } from '../library/import-service'
import { validateChatInput } from './errors'
import { AiGatewayError, describeAiError, normalizeOpenAiBaseUrl } from './errors'
import { buildProviderHeaders, processSessionIdForSingleCall, requiresCustomUserAgent, withPinnedUserAgent } from './provider-headers'
import type { SettingsService } from '../settings/settings-service'
import type { ToolboxStore } from '../chat-store/chat-store'

const AGENT_PROMPT_FILE = 'agent_system.txt'

export interface ChatEventSink {
  onDelta(event: ChatDeltaEvent): void
  onCompleted(event: ChatCompletedEvent): void
  onError(event: ChatErrorEvent): void
  onStopped(event: ChatStoppedEvent): void
  onToolCall(event: AgentToolCallEvent): void
  onToolResult(event: AgentToolResultEvent): void
  onToolApprovalRequest(event: AgentToolApprovalRequestEvent): void
}

/**
 * AI 网关：负责对话请求编排、Agent 工具循环的事件回推，以及取消语义。
 * 具体的数据操作能力由 `ai-gateway` 之外的工具注册表提供（见 services/agent）。
 */
export class AiGateway {
  private readonly active = new Map<string, AbortController>()
  private readonly gate = new ApprovalGate()
  private agentPromptCache: string | null = null

  constructor(
    private readonly settings: SettingsService,
    private readonly chatStore: ToolboxStore,
    private readonly importService: ImportService,
    private readonly promptDir: string
  ) {}

  async send(
    request: ChatSendRequest,
    sink: ChatEventSink
  ): Promise<ChatSendResult> {
    const conversationId = request.conversationId
    if (this.active.has(conversationId)) {
      throw new AiGatewayError('该会话正在生成回复，请先停止或稍候')
    }

    const content = validateChatInput(request.content)
    const conversation = this.requireConversation(conversationId)
    const config = await this.settings.getAiConfig()

    const userMessage = this.chatStore.appendMessage({
      conversationId,
      role: 'user',
      content
    })

    const updatedConversation = this.autoTitle(conversation, content)
    const history = this.chatStore.listMessages(conversationId)
    const controller = new AbortController()
    this.active.set(conversationId, controller)

    void this.runAgentTurn({
      conversationId,
      history,
      config,
      controller,
      sink
    })

    return {
      userMessage,
      conversation: updatedConversation
    }
  }

  stop(conversationId: string): void {
    this.active.get(conversationId)?.abort()
    // 立刻拒绝该会话挂起的审批，避免工具节点一直等用户回执
    this.gate.rejectConversation(conversationId)
  }

  /** 渲染层对写 / 破坏性工具审批的回执 */
  approveTool(input: AgentToolApprovalInput): void {
    this.gate.settle(input.callId, input.approved === true)
  }

  /** 非流式一次性对话：供密码箱 AI 识别等内部工具复用同一份配置与错误映射 */
  async complete(system: string, user: string): Promise<string> {
    const content = validateChatInput(user)
    const config = await this.settings.getAiConfig()
    const model = new ChatOpenAI({
      apiKey: config.apiKey,
      model: config.model,
      temperature: 0,
      timeout: CHAT_TIMEOUT_MS,
      maxRetries: 1,
      configuration: buildClientConfig(config, processSessionIdForSingleCall())
    })

    try {
      const reply = await model.invoke([
        new SystemMessage(system),
        new HumanMessage(content)
      ])
      const text = typeof reply.content === 'string' ? reply.content : ''
      if (!text.trim()) throw new AiGatewayError('AI 未返回内容')
      return text
    } catch (error) {
      if (error instanceof AiGatewayError) throw error
      throw new AiGatewayError(describeAiError(error, config.apiKey), error)
    }
  }

  private async runAgentTurn(input: {
    conversationId: string
    history: ChatMessage[]
    config: AiConfig
    controller: AbortController
    sink: ChatEventSink
  }): Promise<void> {
    const { conversationId, history, config, controller, sink } = input

    try {
      const model = new ChatOpenAI({
        apiKey: config.apiKey,
        model: config.model,
        temperature: 0.2,
        timeout: CHAT_TIMEOUT_MS,
        maxRetries: 1,
        // 会话 ID 逐轮稳定，OpenCode Go 依赖它做路由与 prompt 缓存
        configuration: buildClientConfig(config, conversationId)
      })

      const tools = createAgentToolSet({
        store: this.chatStore,
        importService: this.importService
      })

      const result = await runAgent({
        conversationId,
        history,
        model,
        systemPrompt: this.agentSystemPrompt(),
        tools,
        permission: this.currentPermission(),
        gate: this.gate,
        sink: {
          onToolCall: (event) => sink.onToolCall({ conversationId, ...event }),
          onToolResult: (event) => sink.onToolResult({ conversationId, ...event }),
          onToolApprovalRequest: (event) =>
            sink.onToolApprovalRequest({ conversationId, ...event })
        },
        onDelta: (delta) => sink.onDelta({ conversationId, delta }),
        signal: controller.signal
      })

      const content = result.content.trim()
        ? result.content
        : result.usedTools
          ? '已完成操作。'
          : ''
      if (!content.trim()) {
        throw new AiGatewayError('AI 未返回内容')
      }

      const assistantMessage = this.chatStore.appendMessage({
        conversationId,
        role: 'assistant',
        content
      })
      const conversation = this.requireConversation(conversationId)
      sink.onCompleted({ conversationId, message: assistantMessage, conversation })
    } catch (error) {
      if (controller.signal.aborted) {
        sink.onStopped({ conversationId })
      } else {
        sink.onError({
          conversationId,
          message: describeAiError(error, config.apiKey)
        })
      }
    } finally {
      this.gate.rejectConversation(conversationId)
      this.active.delete(conversationId)
    }
  }

  private currentPermission(): AgentPermission {
    const raw = this.chatStore.configGet()
    const value = raw?.agentPermission
    return isAgentPermission(value) ? value : DEFAULT_AGENT_PERMISSION
  }

  private agentSystemPrompt(): string {
    if (this.agentPromptCache === null) {
      try {
        this.agentPromptCache = readFileSync(
          join(this.promptDir, AGENT_PROMPT_FILE),
          'utf8'
        ).trim()
      } catch {
        this.agentPromptCache =
          '你是「私人百宝箱」的内置 AI 助手，可调用工具管理用户的书架、密码箱与记事本。'
      }
    }
    return this.agentPromptCache
  }

  private autoTitle(
    conversation: ConversationSummary,
    content: string
  ): ConversationSummary {
    if (conversation.title !== DEFAULT_CONVERSATION_TITLE) return conversation

    const title =
      content.replace(/\s+/g, ' ').trim().slice(0, CONVERSATION_TITLE_MAX_CHARS) ||
      DEFAULT_CONVERSATION_TITLE
    return this.chatStore.renameConversation(conversation.id, title)
  }

  private requireConversation(conversationId: string): ConversationSummary {
    const conversation = this.chatStore.getConversation(conversationId)
    if (!conversation) throw new AiGatewayError('会话不存在')
    return conversation
  }
}

/**
 * 组装 OpenAI 客户端配置：端点规范化 + 供应商要求的额外请求头。
 * 无额外头时不下发空的 defaultHeaders / fetch，避免覆盖 SDK 默认值。
 */
function buildClientConfig(
  config: AiConfig,
  sessionId: string
): {
  baseURL: string
  defaultHeaders?: Record<string, string>
  fetch?: typeof fetch
} {
  const input = { provider: config.provider, baseUrl: config.baseUrl, sessionId }
  const headers = buildProviderHeaders(input)
  const baseURL = normalizeOpenAiBaseUrl(config.baseUrl)
  if (Object.keys(headers).length === 0) return { baseURL }

  return {
    baseURL,
    defaultHeaders: headers,
    // fetch 必须挂在 ClientOptions 顶层（SDK 用 this.fetch 发请求）；
    // 不能塞进 fetchOptions.headers —— 那会整体替换已构建的请求头
    ...(requiresCustomUserAgent(input)
      ? { fetch: withPinnedUserAgent(globalThis.fetch) }
      : {})
  }
}
