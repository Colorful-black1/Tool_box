import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import { ChatOpenAI } from '@langchain/openai'

import { convertToOpenAITool } from '@langchain/core/utils/function_calling'

import {
  CHAT_TIMEOUT_MS,
  CONVERSATION_TITLE_MAX_CHARS,
  DEFAULT_CONVERSATION_TITLE
} from '../../../shared/constants'
import { trimmedHistoryNotice } from '../../../shared/history'
import type {
  AgentPermission,
  AgentToolApprovalInput,
  AgentToolApprovalRequestEvent,
  AgentToolCallEvent,
  AgentToolResultEvent,
  AiConfig,
  ChatCompactResult,
  ChatCompactionEvent,
  ChatCompletedEvent,
  ChatContextEvent,
  ChatContextUsage,
  ChatContextView,
  ChatDeltaEvent,
  ChatErrorEvent,
  ChatSendRequest,
  ChatSendResult,
  ChatStoppedEvent,
  ConversationSummary
} from '../../../shared/types'
import { DEFAULT_AGENT_PERMISSION, isAgentPermission } from '../../../shared/types'
import { ApprovalGate } from '../agent/approval-gate'
import { runAgent } from '../agent/agent-runner'
import type { RunAgentResult } from '../agent/agent-runner'
import { createAgentToolSet } from '../agent/tools'
import type { AgentDeps } from '../agent/tools'
import { buildLangChainTools, filterToolsByPermission } from '../agent/tool-registry'
import type { AgentToolContext, AgentToolDefinition } from '../agent/tool-registry'
import { ContextService, CompactionUnavailableError } from './context-service'
import type { PreparedContext } from './context-service'
import { referenceMarkdown } from '../../../shared/app-reference'
import type { ImportService } from '../library/import-service'
import { validateChatInput } from './errors'
import {
  AiGatewayError,
  describeAiError,
  isContextOverflowError,
  normalizeOpenAiBaseUrl,
  parseContextLimit
} from './errors'
import { buildProviderHeaders, processSessionIdForSingleCall, requiresCustomUserAgent, withPinnedUserAgent } from './provider-headers'
import type { SettingsService } from '../settings/settings-service'
import type { ToolboxStore } from '../chat-store/chat-store'

const AGENT_PROMPT_FILE = 'agent_system.txt'

/** 无会话调用也使用真实流；不启用工具、不写聊天记录。 */
export interface AiCompletionOptions {
  signal?: AbortSignal
  onDelta?: (delta: string) => void
  maxOutputChars?: number
}

export interface ChatEventSink {
  onDelta(event: ChatDeltaEvent): void
  onCompleted(event: ChatCompletedEvent): void
  onError(event: ChatErrorEvent): void
  onStopped(event: ChatStoppedEvent): void
  onToolCall(event: AgentToolCallEvent): void
  onToolResult(event: AgentToolResultEvent): void
  onToolApprovalRequest(event: AgentToolApprovalRequestEvent): void
  onContext(event: ChatContextEvent): void
  onCompaction(event: ChatCompactionEvent): void
}

/**
 * AI 网关：负责对话请求编排、Agent 工具循环的事件回推，以及取消语义。
 * 具体的数据操作能力由 `ai-gateway` 之外的工具注册表提供（见 services/agent）。
 */
export class AiGateway {
  private readonly active = new Map<string, AbortController>()
  private readonly gate = new ApprovalGate()
  private agentPromptCache: string | null = null
  private readonly contextService: ContextService
  private readonly lastUsage = new Map<string, ChatContextUsage>()
  private readonly compacting = new Set<string>()
  private readonly manualCompactions = new Map<string, AbortController>()

  constructor(
    private readonly settings: SettingsService,
    private readonly chatStore: ToolboxStore,
    private readonly importService: ImportService,
    private readonly promptDir: string,
    private readonly toolServices: Pick<AgentDeps, 'todos' | 'usage' | 'knowledge'> = {}
  ) {
    this.contextService = new ContextService(chatStore, promptDir)
  }

  async send(
    request: ChatSendRequest,
    sink: ChatEventSink
  ): Promise<ChatSendResult> {
    const conversationId = request.conversationId
    if (this.active.has(conversationId) || this.manualCompactions.has(conversationId)) {
      throw new AiGatewayError(
        this.manualCompactions.has(conversationId)
          ? '正在压缩上下文，请稍候'
          : '该会话正在生成回复，请先停止或稍候'
      )
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
    const controller = new AbortController()
    this.active.set(conversationId, controller)

    void this.runAgentTurn({
      conversationId,
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
    this.manualCompactions.get(conversationId)?.abort()
    this.compacting.delete(conversationId)
    // 立刻拒绝该会话挂起的审批，避免工具节点一直等用户回执
    this.gate.rejectConversation(conversationId)
  }

  /** 恢复本机快照前不得让仍在写入对话的任务被退出流程中断。 */
  hasActiveRuns(): boolean {
    return this.active.size > 0 || this.manualCompactions.size > 0
  }

  /** 渲染层对写 / 破坏性工具审批的回执 */
  approveTool(input: AgentToolApprovalInput): void {
    this.gate.settle(input.callId, input.approved === true)
  }

  /** 无会话流式调用，增量即时回推，返回完整正文供业务校验。 */
  async complete(system: string, user: string, options: AiCompletionOptions = {}): Promise<string> {
    options.signal?.throwIfAborted()
    const content = validateChatInput(user)
    const config = await this.settings.getAiConfig()
    const model = new ChatOpenAI({
      apiKey: config.apiKey,
      model: config.model,
      temperature: 0,
      timeout: CHAT_TIMEOUT_MS,
      maxRetries: 0,
      configuration: buildClientConfig(config, processSessionIdForSingleCall())
    })
    const controller = new AbortController()
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, CHAT_TIMEOUT_MS)
    const abort = (): void => controller.abort()
    options.signal?.addEventListener('abort', abort)
    if (options.signal?.aborted) controller.abort()

    try {
      const stream = await model.stream(
        [new SystemMessage(system), new HumanMessage(content)],
        { signal: controller.signal }
      )
      let text = ''
      for await (const chunk of stream) {
        controller.signal.throwIfAborted()
        const delta = chunk.text
        if (!delta) continue
        text += delta
        if (text.length > (options.maxOutputChars ?? 200_000))
          throw new AiGatewayError('AI 输出过长，请拆分后重试')
        options.onDelta?.(delta)
      }
      controller.signal.throwIfAborted()
      if (!text.trim()) throw new AiGatewayError('AI 未返回内容')
      return text
    } catch (error) {
      if (timedOut) throw new AiGatewayError('AI 请求超时，请检查网络后重试')
      if (options.signal?.aborted) throw new DOMException('已停止', 'AbortError')
      if (error instanceof AiGatewayError) throw error
      throw new AiGatewayError(describeAiError(error, config.apiKey), error)
    } finally {
      clearTimeout(timer)
      options.signal?.removeEventListener('abort', abort)
    }
  }

  private async runAgentTurn(input: {
    conversationId: string
    config: AiConfig
    controller: AbortController
    sink: ChatEventSink
  }): Promise<void> {
    const { conversationId, config, controller, sink } = input

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
      const summaryModel = this.createSummaryModel(config, conversationId)

      const tools = this.toolDefinitions()
      const permission = this.currentPermission()
      const basePrompt = this.agentSystemPrompt(0)
      let info = await this.settings.getActiveContextInfo()
      const buildPrepareInput = (force: boolean) => ({
        conversationId,
        model: config.model,
        provider: info?.provider ?? '',
        baseUrl: info?.baseUrl ?? '',
        limit: info?.limit ?? null,
        systemPrompt: basePrompt,
        toolSchemas: this.toolSchemas(tools, permission),
        lastUsage: this.lastUsage.get(conversationId) ?? null,
        autoCompact: this.autoCompact(),
        compacting: this.compacting.has(conversationId),
        summaryModel,
        signal: controller.signal,
        force,
        onCompacting: (active: boolean) => {
          if (active) {
            this.compacting.add(conversationId)
            sink.onCompaction({ conversationId, phase: 'started' })
          } else {
            this.compacting.delete(conversationId)
          }
        }
      })
      let prepared = await this.contextService.prepare(buildPrepareInput(false))
      this.reportPreparedCompaction(conversationId, prepared, sink)

      let sawOutput = false
      let sawTool = false
      const runOnce = (context: PreparedContext) =>
        runAgent({
          conversationId,
          history: context.history,
          ...(context.summary ? { summary: context.summary } : {}),
          model,
          systemPrompt:
            context.fallbackDropped > 0
              ? this.agentSystemPrompt(context.fallbackDropped)
              : basePrompt,
          tools,
          permission,
          gate: this.gate,
          sink: {
            onToolCall: (event) => {
              sawTool = true
              sink.onToolCall({ conversationId, ...event })
            },
            onToolResult: (event) => sink.onToolResult({ conversationId, ...event }),
            onToolApprovalRequest: (event) =>
              sink.onToolApprovalRequest({ conversationId, ...event })
          },
          onDelta: (delta) => {
            sawOutput = true
            sink.onDelta({ conversationId, delta })
          },
          signal: controller.signal
        })

      let result: RunAgentResult
      try {
        result = await runOnce(prepared)
      } catch (error) {
        // 已经输出或执行过工具时不能重试，否则可能重复写操作 / 重复文本
        if (
          controller.signal.aborted ||
          sawOutput ||
          sawTool ||
          !isContextOverflowError(error)
        ) {
          throw error
        }
        const limit = parseContextLimit(error)
        if (limit) {
          try {
            await this.settings.recordLearnedContextLimit(config.model, limit)
          } catch {
            // 学习值落盘失败不能影响本次恢复；仍用解析到的 N 压缩
          }
          // 即使手动值更高，本次恢复也按供应商确认的真实上限来压缩
          info = {
            model: config.model,
            provider: config.provider,
            baseUrl: config.baseUrl,
            limit: { tokens: limit, source: 'learned', updatedAtMs: Date.now() }
          }
        }
        prepared = await this.contextService.prepare(buildPrepareInput(true))
        this.reportPreparedCompaction(conversationId, prepared, sink)
        result = await runOnce(prepared)
      }

      this.recordUsage(conversationId, result.usage, config.model)

      const text = result.content.trim()
        ? result.content
        : result.usedTools
          ? '已完成操作。'
          : ''
      if (!text.trim()) {
        throw new AiGatewayError('AI 未返回内容')
      }
      const content = result.references.length
        ? `${text}\n\n相关入口：\n${result.references.map((item) => `- ${referenceMarkdown(item)}`).join('\n')}`
        : text

      const assistantMessage = this.chatStore.appendMessage({
        conversationId,
        role: 'assistant',
        content
      })
      const conversation = this.requireConversation(conversationId)
      sink.onCompleted({ conversationId, message: assistantMessage, conversation })
      await this.emitContext(conversationId, sink)
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
      this.compacting.delete(conversationId)
    }
  }

  private reportPreparedCompaction(
    conversationId: string,
    prepared: PreparedContext,
    sink: ChatEventSink
  ): void {
    if (prepared.compacted) {
      sink.onCompaction({
        conversationId,
        phase: 'finished',
        result: {
          compacted: true,
          coveredMessages: prepared.checkpoint?.coveredMessageCount ?? 0,
          freedTokens: prepared.freedTokens ?? 0,
          ...(prepared.checkpoint ? { checkpoint: prepared.checkpoint } : {})
        }
      })
    } else if (prepared.fallbackDropped > 0) {
      sink.onCompaction({
        conversationId,
        phase: 'failed',
        message: '自动压缩失败，本次仅携带最近对话'
      })
    }
  }

  /** 手动压缩：与生成互斥；压缩期间继续拒绝新的发送 */
  async compact(conversationId: string, sink: ChatEventSink): Promise<ChatCompactResult> {
    this.requireConversation(conversationId)
    if (this.active.has(conversationId)) {
      throw new AiGatewayError('该会话正在生成回复，请先停止')
    }
    if (this.manualCompactions.has(conversationId)) {
      throw new AiGatewayError('正在压缩上下文，请稍候')
    }

    const config = await this.settings.getAiConfig()
    const info = await this.settings.getActiveContextInfo()
    const controller = new AbortController()
    this.manualCompactions.set(conversationId, controller)
    this.compacting.add(conversationId)
    sink.onCompaction({ conversationId, phase: 'started' })

    try {
      const tools = this.toolDefinitions()
      const permission = this.currentPermission()
      const result = await this.contextService.compact({
        conversationId,
        model: config.model,
        provider: info?.provider ?? '',
        baseUrl: info?.baseUrl ?? '',
        limit: info?.limit ?? null,
        systemPrompt: this.agentSystemPrompt(0),
        toolSchemas: this.toolSchemas(tools, permission),
        lastUsage: this.lastUsage.get(conversationId) ?? null,
        autoCompact: this.autoCompact(),
        compacting: true,
        summaryModel: this.createSummaryModel(config, conversationId),
        signal: controller.signal
      })

      this.compacting.delete(conversationId)
      sink.onCompaction({
        conversationId,
        phase: result.compacted ? 'finished' : 'skipped',
        ...(result.message ? { message: result.message } : {}),
        result
      })
      if (result.compacted) await this.emitContext(conversationId, sink)
      return result
    } catch (error) {
      const message = controller.signal.aborted
        ? '压缩已停止'
        : error instanceof CompactionUnavailableError
          ? error.message
          : describeAiError(error, config.apiKey)
      sink.onCompaction({ conversationId, phase: 'failed', message })
      throw new AiGatewayError(message, error)
    } finally {
      this.manualCompactions.delete(conversationId)
      this.compacting.delete(conversationId)
    }
  }

  /** 标题栏 / 浮层只读视图；不要求已配置 API Key */
  async context(conversationId: string): Promise<ChatContextView> {
    this.requireConversation(conversationId)
    const info = await this.settings.getActiveContextInfo()
    const permission = this.currentPermission()
    return this.contextService.view({
      conversationId,
      model: info?.model ?? '',
      provider: info?.provider ?? '',
      baseUrl: info?.baseUrl ?? '',
      limit: info?.limit ?? null,
      systemPrompt: this.agentSystemPrompt(0),
      toolSchemas: this.toolSchemas(this.toolDefinitions(), permission),
      lastUsage: this.lastUsage.get(conversationId) ?? null,
      autoCompact: this.autoCompact(),
      compacting: this.compacting.has(conversationId)
    })
  }

  private async emitContext(conversationId: string, sink: ChatEventSink): Promise<void> {
    try {
      sink.onContext({ conversationId, context: await this.context(conversationId) })
    } catch (error) {
      // 上下文视图失败不能影响已经完成的回复
      console.warn('[Context] 上下文视图刷新失败', {
        conversationId,
        reason: error instanceof Error ? error.name : 'unknown'
      })
    }
  }

  private toolDefinitions(): AgentToolDefinition[] {
    return createAgentToolSet({
      store: this.chatStore,
      importService: this.importService,
      ...this.toolServices
    })
  }

  private toolSchemas(
    definitions: AgentToolDefinition[],
    permission: AgentPermission
  ): unknown[] {
    const ctx: AgentToolContext = {
      conversationId: '',
      notifyToolCall: () => undefined,
      notifyToolResult: () => undefined,
      requestApproval: async () => false
    }
    return buildLangChainTools(filterToolsByPermission(definitions, permission), permission, ctx).map(
      (tool) => convertToOpenAITool(tool)
    )
  }

  private createSummaryModel(config: AiConfig, conversationId: string): ChatOpenAI {
    return new ChatOpenAI({
      apiKey: config.apiKey,
      model: config.model,
      temperature: 0,
      maxTokens: 2_000,
      timeout: CHAT_TIMEOUT_MS,
      maxRetries: 0,
      configuration: buildClientConfig(config, `${conversationId}:compaction`)
    })
  }

  private recordUsage(
    conversationId: string,
    usage: { inputTokens: number; outputTokens: number; totalTokens: number } | null,
    model: string
  ): void {
    if (!usage) return
    this.lastUsage.set(conversationId, {
      ...usage,
      model,
      measuredAtMs: Date.now()
    })
  }

  private autoCompact(): boolean {
    return this.chatStore.configGet()?.contextAutoCompact !== false
  }

  private currentPermission(): AgentPermission {
    const raw = this.chatStore.configGet()
    const value = raw?.agentPermission
    return isAgentPermission(value) ? value : DEFAULT_AGENT_PERMISSION
  }

  private agentSystemPrompt(dropped = 0): string {
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
    const prompt = `${this.agentPromptCache}\n\n当前本机时间：${new Date().toLocaleString('sv-SE')}；时区：${Intl.DateTimeFormat().resolvedOptions().timeZone}。相对日期以此为准。`
    return dropped > 0 ? `${prompt}\n\n${trimmedHistoryNotice(dropped)}` : prompt
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
