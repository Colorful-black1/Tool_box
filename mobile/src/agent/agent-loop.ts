/**
 * Agent 循环（手机端）：模型 ⇄ 工具往返。
 *
 * 桌面端由 LangChain 的 `createAgent` 承担这一段；手机端不搬 LangChain，
 * 所以这里手写循环，只做三件事：发请求 → 有工具调用就执行并把结果作为
 * `role:'tool'` 消息追加 → 再来一轮，直到模型给出最终回答或超过步数上限。
 *
 * 与桌面端对齐的语义：
 * - 工具轨迹**不落库**（不接 checkpointer），只把最终 assistant 文本写进 messages 表；
 * - 每轮正文增量都实时回推，因此「先说一句再调工具」的顺序在界面上是可见的；
 * - 不提供只读之外的硬编码拦截：过滤由权限档位决定（见 tool-registry）。
 *
 * 本文件不 import 任何 RN / Node 模块，可在 vitest 中用假 fetch 直接测。
 */
import { AiGatewayError } from '../shared-bridge'
import type { AgentPermission, AgentToolRisk, AiProviderId, ChatMessage } from '../shared-bridge'
import { streamChat } from '../ai/stream-chat'
import type { FetchLike } from '../ai/stream-chat'
import type { WireMessage } from '../ai/wire'
import type { ApprovalGate } from './approval-gate'
import { filterToolsByPermission, runTool, toToolSchemas } from './tool-registry'
import type { AgentToolContext, AgentToolDefinition } from './tool-registry'

/**
 * 一轮对话最多允许几次「模型 ⇄ 工具」往返。
 *
 * 桌面端给 60（要跑长任务）；手机端给 12 —— 移动端的等待与流量成本更高，
 * 且这里的场景（查书架 / 记事本 / 密码箱）本来就不需要长链。
 */
export const AGENT_MAX_STEPS = 12

/** 工具过程上报给界面 */
export interface AgentToolSink {
  onToolCall(event: { callId: string; name: string; args: string }): void
  onToolResult(event: { callId: string; ok: boolean; summary: string }): void
  onToolApprovalRequest(event: {
    callId: string
    name: string
    args: string
    risk: AgentToolRisk
  }): void
}

export interface AgentRunInput {
  conversationId: string
  history: ChatMessage[]
  config: { provider: AiProviderId; baseUrl: string; model: string; apiKey: string }
  /** 系统提示词，固定作为第一条 system 消息下发 */
  systemPrompt: string
  permission: AgentPermission
  tools: AgentToolDefinition[]
  gate: ApprovalGate
  sink: AgentToolSink
  onDelta(text: string): void
  /** 降级等需要告知用户的情况（不是错误） */
  onNotice?(message: string): void
  signal: AbortSignal
  fetchImpl: FetchLike
  timeoutMs: number
  /** 默认 0.2：工具场景需要稳定，与桌面端一致 */
  temperature?: number
  /** 网关没给 tool_call id 时的兜底 id 生成（注入以便单测可预期） */
  idFactory: () => string
}

export interface AgentRunResult {
  content: string
  /** 是否真正执行过工具（用于「已完成操作。」这类兜底文案） */
  usedTools: boolean
}

export async function runAgent(input: AgentRunInput): Promise<AgentRunResult> {
  const allowed = filterToolsByPermission(input.tools, input.permission)
  const schemas = toToolSchemas(allowed)
  const byName = new Map(allowed.map((definition) => [definition.name, definition]))

  // 关掉工具后不再重新打开：一次降级就够，避免「降级—失败—再降级」的死循环
  let toolsEnabled = schemas.length > 0
  let downgraded = false
  let content = ''
  let usedTools = false
  let step = 0

  const messages: WireMessage[] = [
    { role: 'system', content: input.systemPrompt },
    ...input.history.map((message) => ({
      role: message.role,
      content: message.content
    }))
  ]

  const context: AgentToolContext = {
    conversationId: input.conversationId,
    notifyToolCall: (event) => {
      usedTools = true
      input.sink.onToolCall(event)
    },
    notifyToolResult: (event) => input.sink.onToolResult(event),
    requestApproval: async (event) => {
      // 先武装审批门再通知界面：否则界面上「允许」回来得比挂起更早时会漏掉这次回执
      const pending = input.gate.request(event.callId, input.conversationId)
      input.sink.onToolApprovalRequest(event)
      return pending
    }
  }

  while (step < AGENT_MAX_STEPS) {
    let emitted = false
    let result: Awaited<ReturnType<typeof streamChat>>
    try {
      result = await streamChat({
        baseUrl: input.config.baseUrl,
        apiKey: input.config.apiKey,
        model: input.config.model,
        provider: input.config.provider,
        // 会话 id 逐轮稳定，OpenCode Go 依赖它做路由与 prompt 缓存
        sessionId: input.conversationId,
        messages,
        tools: toolsEnabled ? schemas : undefined,
        signal: input.signal,
        timeoutMs: input.timeoutMs,
        temperature: input.temperature ?? 0.2,
        fetchImpl: input.fetchImpl,
        onDelta: (delta) => {
          emitted = true
          input.onDelta(delta)
        }
      })
    } catch (error) {
      // 降级：部分 OpenAI 兼容网关不认识 tools 参数，直接 400。
      // 只在「这一轮还没吐出任何正文」时降级，否则界面上会出现重复文本。
      if (
        toolsEnabled &&
        !downgraded &&
        !emitted &&
        looksLikeToolsUnsupported(errorMessage(error))
      ) {
        downgraded = true
        toolsEnabled = false
        input.onNotice?.('当前模型不支持工具调用，已降级为普通对话')
        continue
      }
      throw error
    }

    content += result.content

    if (result.toolCalls.length === 0) {
      return { content, usedTools }
    }

    // assistant 的 tool_calls 必须先入列，工具结果才有东西可回应
    messages.push({ role: 'assistant', content: result.content, toolCalls: result.toolCalls })

    for (const call of result.toolCalls) {
      const callId = call.id || input.idFactory()
      const definition = byName.get(call.name)
      const output = definition
        ? await runTool({
            definition,
            callId,
            rawArguments: call.arguments,
            permission: input.permission,
            ctx: context
          })
        : unknownTool(callId, call.name, context)
      messages.push({ role: 'tool', toolCallId: callId, content: output })
    }

    step++
  }

  throw new AiGatewayError('工具调用轮次过多，已中止。请把需求拆小一点再试')
}

/** 模型调了不存在的工具：如实回给它，比静默忽略更容易让它自我纠正 */
function unknownTool(callId: string, name: string, ctx: AgentToolContext): string {
  ctx.notifyToolCall({ callId, name, args: '' })
  ctx.notifyToolResult({ callId, ok: false, summary: `未知工具：${name}` })
  return `未知工具：${name}。请只使用已提供的工具。`
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * 判断错误是否像「这个网关不支持 tools 参数」。
 *
 * 为什么不无条件降级重试：网络超时、401 也会走进 catch，
 * 无脑重发会让用户多等一整个超时（对话超时是 120s）。
 * 因此要求文案**同时**命中「工具相关」与「请求无效」两组关键词。
 *
 * 注意匹配的是 `describeAiError` 映射之后的文案：401 / 404 / 超时 / 网络
 * 都会被换成中文固定说法，不会误命中；而 400 会保留服务端原文，正是我们要读的。
 */
export function looksLikeToolsUnsupported(message: string): boolean {
  return TOOLS_MENTION.test(message) && REQUEST_INVALID.test(message)
}

const TOOLS_MENTION = /tool|function[_ ]call/i
const REQUEST_INVALID = /400|invalid|unsupported|not support|unexpected|参数|不支持/i
