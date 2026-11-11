import { AIMessage, HumanMessage, SystemMessage, trimMessages } from '@langchain/core/messages'
import type { BaseMessage } from '@langchain/core/messages'
import type { BaseChatModel } from '@langchain/core/language_models/chat_models'

import {
  DEFAULT_CONTEXT_WINDOW_TOKENS,
  hasShrunkEnough,
  isValidContextWindow,
  resolveContextBudget
} from '../../../shared/context-budget'
import {
  estimateMessageTokens,
  estimateMessagesTokens,
  estimateTextTokens
} from '../../../shared/context-tokens'
import type {
  ChatCheckpointView,
  ChatCompactResult,
  ChatContextUsage,
  ChatContextView,
  ChatMessage,
  ContextWindowSource,
  ModelContextLimitView
} from '../../../shared/types'
import { catalogContextWindow } from '../../../shared/model-context'
import type { ChatCheckpointInput } from '../chat-store/chat-store'
import type { ToolboxStore } from '../chat-store/chat-store'
import {
  checkpointContent,
  loadSummaryPrompt,
  sanitizeSummary
} from './context-prompt'

/** 一次压缩的内部结果，包含替换后真正发送的尾部消息 */
export interface CompactionOutcome {
  checkpoint: ChatCheckpointView
  history: ChatMessage[]
  sourceTokens: number
  summaryTokens: number
  freedTokens: number
  coveredMessages: number
}

export interface ContextViewInput {
  conversationId: string
  model: string
  provider: string
  baseUrl: string
  limit: ModelContextLimitView | null
  systemPrompt: string
  toolSchemas: ReadonlyArray<unknown>
  lastUsage: ChatContextUsage | null
  autoCompact: boolean
  compacting: boolean
}

export interface ContextPrepareInput extends ContextViewInput {
  summaryModel: BaseChatModel
  signal: AbortSignal
  /** 供应商已确认超长时的强制压缩：保留更少尾部 */
  force?: boolean
  onCompacting?(active: boolean): void
}

export interface PreparedContext {
  history: ChatMessage[]
  summary?: string
  compacted: boolean
  checkpoint?: ChatCheckpointView
  freedTokens?: number
  /** 自动压缩失败后退回裁剪时丢弃的消息条数 */
  fallbackDropped: number
}

/** 摘要没有带来足够收益，或没有可压缩的完整轮次 */
export class CompactionUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CompactionUnavailableError'
  }
}

interface ContextSnapshot {
  checkpoint: ChatCheckpointView | null
  messages: ChatMessage[]
  totalMessages: number
  windowTokens: number
  windowSource: ContextWindowSource
  fixedTokens: number
  summaryTokens: number
  messageTokens: number
  estimatedTokens: number
  thresholdTokens: number
}

/**
 * 上下文服务：读取检查点、估算占用、选段与调用摘要模型。
 *
 * 不直接持有 AiGateway 的锁与事件：自动 / 手动压缩的编排仍在 Gateway，
 * 这里只做「算清楚 + 压出检查点」。
 */
export class ContextService {
  constructor(
    private readonly store: ToolboxStore,
    private readonly promptDir: string
  ) {}

  async view(input: ContextViewInput): Promise<ChatContextView> {
    const snapshot = this.snapshot(input)
    return {
      conversationId: input.conversationId,
      model: input.model,
      windowTokens: snapshot.windowTokens,
      windowSource: snapshot.windowSource,
      thresholdTokens: snapshot.thresholdTokens,
      estimatedTokens: snapshot.estimatedTokens,
      percent: Math.round((snapshot.estimatedTokens / snapshot.windowTokens) * 100),
      breakdown: {
        system: estimateTextTokens(input.systemPrompt),
        tools: estimateToolSchemas(input.toolSchemas),
        summary: snapshot.summaryTokens,
        messages: snapshot.messageTokens
      },
      lastUsage: input.lastUsage,
      checkpoint: snapshot.checkpoint,
      autoCompact: input.autoCompact,
      compacting: input.compacting,
      messageCount: snapshot.totalMessages
    }
  }

  /** 发送前准备上下文：需要压缩时先压缩，失败退回无摘要裁剪 */
  async prepare(input: ContextPrepareInput): Promise<PreparedContext> {
    const snapshot = this.snapshot(input)
    if (
      !input.force &&
      (!input.autoCompact || snapshot.estimatedTokens <= snapshot.thresholdTokens)
    ) {
      return {
        history: snapshot.messages,
        ...(snapshot.checkpoint ? { summary: snapshot.checkpoint.summary } : {}),
        compacted: false,
        fallbackDropped: 0
      }
    }

    const budget = resolveContextBudget({
      windowTokens: snapshot.windowTokens,
      fixedTokens: snapshot.fixedTokens
    })
    input.onCompacting?.(true)
    try {
      const outcome = await this.compactInternal(input, snapshot, {
        tailBudget: input.force ? forceTailBudget(snapshot.windowTokens) : budget.keepTokens
      })
      return {
        history: outcome.history,
        summary: outcome.checkpoint.summary,
        compacted: true,
        checkpoint: outcome.checkpoint,
        freedTokens: outcome.freedTokens,
        fallbackDropped: 0
      }
    } catch (error) {
      // 自动压缩失败不应阻塞发送：退回 token 裁剪，并在 system prompt 里明说
      if (input.signal.aborted) throw error
      console.warn('[Context] 自动压缩失败，本次仅携带最近对话', {
        conversationId: input.conversationId,
        messages: snapshot.messages.length,
        reason: error instanceof Error ? error.name : 'unknown'
      })
      const fallback = await this.trimFallback(snapshot)
      return {
        history: fallback.history,
        ...(snapshot.checkpoint ? { summary: snapshot.checkpoint.summary } : {}),
        compacted: false,
        fallbackDropped: fallback.dropped
      }
    } finally {
      input.onCompacting?.(false)
    }
  }

  /** 手动压缩：不满足条件或失败时直接抛给上层显示 */
  async compact(input: ContextPrepareInput): Promise<ChatCompactResult> {
    const snapshot = this.snapshot(input)
    if (snapshot.messages.length <= 2) {
      return { compacted: false, coveredMessages: 0, freedTokens: 0, message: '对话还短，无需压缩' }
    }

    const budget = resolveContextBudget({
      windowTokens: snapshot.windowTokens,
      fixedTokens: snapshot.fixedTokens
    })
    input.onCompacting?.(true)
    try {
      const outcome = await this.compactInternal(input, snapshot, {
        tailBudget: input.force ? forceTailBudget(snapshot.windowTokens) : budget.keepTokens
      })
      return {
        compacted: true,
        coveredMessages: outcome.coveredMessages,
        freedTokens: outcome.freedTokens,
        checkpoint: outcome.checkpoint
      }
    } finally {
      input.onCompacting?.(false)
    }
  }

  private snapshot(input: ContextViewInput): ContextSnapshot {
    const checkpoint = this.store.latestCheckpoint(input.conversationId)
    const messages = this.store.listMessagesAfter(
      input.conversationId,
      checkpoint?.coveredMessageId ?? null
    )
    const totalMessages = this.store.messageCount(input.conversationId)
    const window = resolveWindow(input.limit, input.provider, input.model, input.baseUrl)
    const fixedTokens = estimateTextTokens(input.systemPrompt) + estimateToolSchemas(input.toolSchemas)
    const summaryTokens = checkpoint ? estimateTextTokens(checkpointContent(checkpoint.summary)) : 0
    const messageTokens = estimateMessagesTokens(messages)
    const estimatedTokens = fixedTokens + summaryTokens + messageTokens
    const budget = resolveContextBudget({ windowTokens: window.tokens, fixedTokens })
    return {
      checkpoint,
      messages,
      totalMessages,
      windowTokens: window.tokens,
      windowSource: window.source,
      fixedTokens,
      summaryTokens,
      messageTokens,
      estimatedTokens,
      thresholdTokens: budget.thresholdTokens
    }
  }

  private async compactInternal(
    input: ContextPrepareInput,
    snapshot: ContextSnapshot,
    options: { tailBudget: number }
  ): Promise<CompactionOutcome> {
    const tail = await selectTail(snapshot.messages, options.tailBudget)
    const tailIds = new Set(tail.map((message) => message.id))
    const sourceMessages = snapshot.messages.filter((message) => !tailIds.has(message.id))
    if (sourceMessages.length === 0) {
      throw new CompactionUnavailableError('没有可压缩的较早消息')
    }

    const oldSummary = snapshot.checkpoint?.summary?.trim() ?? ''
    const sourceTokens =
      estimateMessagesTokens(sourceMessages) + (oldSummary ? estimateTextTokens(oldSummary) : 0)
    if (sourceTokens < 1_000) {
      throw new CompactionUnavailableError('较早消息太少，压缩不会释放空间')
    }

    const summaryInputBudget = Math.max(
      1_000,
      snapshot.windowTokens - 8_192 - 2_000 - 2_048
    )
    const trimmedSource = await trimSource(
      sourceMessages,
      oldSummary ? summaryInputBudget - estimateTextTokens(oldSummary) : summaryInputBudget
    )
    const omitted = sourceMessages.length - trimmedSource.length
    if (trimmedSource.length === 0) {
      throw new CompactionUnavailableError('可压缩的消息不足')
    }

    const summaryMessages: BaseMessage[] = []
    if (oldSummary) summaryMessages.push(new HumanMessage(oldSummary))
    summaryMessages.push(...trimmedSource.map(toBaseMessage))
    const prompt = loadSummaryPrompt(this.promptDir)
    input.signal.throwIfAborted()

    const response = await input.summaryModel.invoke(
      [new SystemMessage(input.systemPrompt), ...summaryMessages, new HumanMessage(prompt)],
      { signal: input.signal }
    )
    const raw = contentText(response.content)
    const summary = sanitizeSummary(raw)
    if (!summary || summary.length < 20) {
      throw new CompactionUnavailableError('模型没有返回有效的检查点摘要')
    }

    const summaryTokens = estimateTextTokens(checkpointContent(summary))
    if (!hasShrunkEnough(sourceTokens, summaryTokens)) {
      throw new CompactionUnavailableError('摘要未能有效压缩，已保留原上下文')
    }

    const beforeTokens = snapshot.estimatedTokens
    const tailTokens = estimateMessagesTokens(tail)
    const afterTokens = snapshot.fixedTokens + summaryTokens + tailTokens
    if (afterTokens >= beforeTokens - 1_000) {
      throw new CompactionUnavailableError('压缩后上下文没有明显变小')
    }

    // 边界必须覆盖全部 source，而不是只覆盖真正送进摘要的那部分；
    // 否则被二次裁剪的消息会继续留在下一轮上下文里，压缩等于没做。
    const covered = sourceMessages[sourceMessages.length - 1]
    const checkpointInput: ChatCheckpointInput = {
      conversationId: input.conversationId,
      summary,
      coveredMessageId: covered.id,
      coveredMessageCount: (snapshot.checkpoint?.coveredMessageCount ?? 0) + sourceMessages.length,
      omittedMessageCount: omitted,
      summaryTokens,
      sourceTokens,
      model: input.model
    }
    const checkpoint = this.store.insertCheckpoint(checkpointInput)

    return {
      checkpoint,
      history: tail,
      sourceTokens,
      summaryTokens,
      freedTokens: Math.max(0, beforeTokens - afterTokens),
      coveredMessages: sourceMessages.length
    }
  }

  private async trimFallback(
    snapshot: ContextSnapshot
  ): Promise<{ history: ChatMessage[]; dropped: number }> {
    const budget = resolveContextBudget({
      windowTokens: snapshot.windowTokens,
      fixedTokens: snapshot.fixedTokens
    })
    const maxTokens = Math.max(
      1_000,
      budget.thresholdTokens - snapshot.fixedTokens - snapshot.summaryTokens
    )
    const kept = await selectTail(snapshot.messages, maxTokens)
    return {
      history: kept,
      dropped: snapshot.messages.length - kept.length
    }
  }
}

function resolveWindow(
  limit: ModelContextLimitView | null,
  provider: string,
  model: string,
  baseUrl: string
): {
  tokens: number
  source: ContextWindowSource
} {
  if (limit && isValidContextWindow(limit.tokens)) {
    return { tokens: limit.tokens, source: limit.source }
  }
  // 接口 / 手动 / 学习都没有时，才按供应商目录兜底；仍不按模型名跨供应商猜
  const catalog = catalogContextWindow(provider, model, baseUrl)
  if (catalog !== null) return { tokens: catalog, source: 'catalog' }
  return { tokens: DEFAULT_CONTEXT_WINDOW_TOKENS, source: 'default' }
}

function estimateToolSchemas(toolSchemas: ReadonlyArray<unknown>): number {
  let total = 0
  for (const schema of toolSchemas) {
    try {
      total += estimateTextTokens(JSON.stringify(schema) ?? '') + 8
    } catch {
      // 无法序列化的 schema 只按 0 计，不能阻断上下文视图
    }
  }
  return total
}

function forceTailBudget(windowTokens: number): number {
  return Math.max(500, Math.min(2_000, Math.floor(windowTokens * 0.1)))
}

/** 用 LangChain trimMessages 从后往前保留完整消息；失败时退回最后两条 */
async function selectTail(messages: ChatMessage[], maxTokens: number): Promise<ChatMessage[]> {
  if (messages.length <= 2) return messages
  try {
    const kept = await trimMessages(messages.map(toBaseMessage), {
      maxTokens,
      tokenCounter: (items) =>
        items.reduce(
          (sum, message) => sum + estimateMessageTokens({ content: messageText(message) }),
          0
        ),
      strategy: 'last',
      startOn: 'human',
      allowPartial: false,
      includeSystem: false
    })
    const byId = new Map(messages.map((message) => [message.id, message]))
    const selected = kept
      .map((message) => (message.id ? byId.get(message.id) : undefined))
      .filter((message): message is ChatMessage => Boolean(message))
    if (selected.length === 0) return messages.slice(-2)

    // 最新一条用户消息必须保留；trimMessages 的边界偶尔会把它切掉
    let lastUserIndex = -1
    for (let index = messages.length - 1; index >= 0; index--) {
      if (messages[index].role === 'user') {
        lastUserIndex = index
        break
      }
    }
    const firstIndex = messages.findIndex((message) => message.id === selected[0].id)
    if (lastUserIndex >= 0 && firstIndex > lastUserIndex) {
      return messages.slice(Math.max(0, lastUserIndex - 1))
    }
    return selected
  } catch {
    return messages.slice(-2)
  }
}

async function trimSource(messages: ChatMessage[], maxTokens: number): Promise<ChatMessage[]> {
  if (messages.length === 0) return []
  if (estimateMessagesTokens(messages) <= maxTokens) return messages
  try {
    const kept = await trimMessages(messages.map(toBaseMessage), {
      maxTokens,
      tokenCounter: (items) =>
        items.reduce(
          (sum, message) => sum + estimateMessageTokens({ content: messageText(message) }),
          0
        ),
      strategy: 'last',
      startOn: 'human',
      allowPartial: false,
      includeSystem: false
    })
    const byId = new Map(messages.map((message) => [message.id, message]))
    const selected = kept
      .map((message) => (message.id ? byId.get(message.id) : undefined))
      .filter((message): message is ChatMessage => Boolean(message))
    return selected.length > 0 ? selected : messages.slice(-5)
  } catch {
    return messages.slice(-5)
  }
}

function toBaseMessage(message: ChatMessage): BaseMessage {
  return message.role === 'user'
    ? new HumanMessage({ content: message.content, id: message.id })
    : new AIMessage({ content: message.content, id: message.id })
}

function messageText(message: BaseMessage): string {
  if (typeof message.content === 'string') return message.content
  if (!Array.isArray(message.content)) return ''
  return message.content
    .map((part) => {
      if (typeof part === 'string') return part
      if (typeof part === 'object' && part !== null && 'text' in part) {
        const text = (part as { text?: unknown }).text
        return typeof text === 'string' ? text : ''
      }
      return ''
    })
    .join('')
}

function contentText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((part) => {
      if (typeof part === 'string') return part
      if (typeof part === 'object' && part !== null && 'text' in part) {
        const text = (part as { text?: unknown }).text
        return typeof text === 'string' ? text : ''
      }
      return ''
    })
    .join('')
}
