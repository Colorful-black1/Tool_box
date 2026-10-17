import { AIMessage, HumanMessage } from '@langchain/core/messages'
import type { AIMessageChunk, BaseMessage } from '@langchain/core/messages'
import type { ChatOpenAI } from '@langchain/openai'
import { createAgent } from 'langchain'

import type { AgentPermission, AgentToolRisk, ChatMessage } from '../../../shared/types'
import type { ApprovalGate } from './approval-gate'
import { buildLangChainTools, filterToolsByPermission } from './tool-registry'
import type { AgentToolContext, AgentToolDefinition } from './tool-registry'

/** Agent 循环最大步数，防止工具调用死循环 */
const AGENT_RECURSION_LIMIT = 60

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

export interface RunAgentInput {
  conversationId: string
  history: ChatMessage[]
  model: ChatOpenAI
  systemPrompt: string
  tools: AgentToolDefinition[]
  permission: AgentPermission
  gate: ApprovalGate
  sink: AgentToolSink
  onDelta(text: string): void
  signal: AbortSignal
}

export interface RunAgentResult {
  content: string
  usedTools: boolean
}

/**
 * 运行一轮 Agent：模型 ⇄ 工具循环。
 *
 * 说明：
 * - 不接 checkpointer，历史由调用方（ToolboxStore）每轮喂入，工具轨迹不落库；
 * - token 级文本用 `streamEvents` 增量回推，工具过程由工具包装层自行上报；
 * - `signal` 中止时由上层捕获并转为「已停止」。
 */
export async function runAgent(input: RunAgentInput): Promise<RunAgentResult> {
  const { conversationId, history, model, systemPrompt, tools, permission, gate, sink } = input

  let usedTools = false
  const context: AgentToolContext = {
    conversationId,
    notifyToolCall: (event) => {
      usedTools = true
      sink.onToolCall(event)
    },
    notifyToolResult: (event) => sink.onToolResult(event),
    requestApproval: (event) => {
      sink.onToolApprovalRequest(event)
      return gate.request(event.callId, conversationId)
    }
  }

  const agent = createAgent({
    model,
    tools: buildLangChainTools(filterToolsByPermission(tools, permission), permission, context),
    systemPrompt
  })

  const stream = agent.streamEvents(
    { messages: toAgentMessages(history) },
    { version: 'v2', signal: input.signal, recursionLimit: AGENT_RECURSION_LIMIT }
  )

  let content = ''
  for await (const event of stream) {
    if (event.event !== 'on_chat_model_stream') continue
    const chunk = (event.data as { chunk?: AIMessageChunk } | undefined)?.chunk
    if (!chunk) continue
    const delta = extractDelta(chunk)
    if (!delta) continue
    content += delta
    input.onDelta(delta)
  }

  return { content, usedTools }
}

function toAgentMessages(messages: ChatMessage[]): BaseMessage[] {
  return messages.map((message) =>
    message.role === 'user' ? new HumanMessage(message.content) : new AIMessage(message.content)
  )
}

/** 从消息分片里取出纯文本增量（忽略工具调用分片与多模态 parts） */
function extractDelta(chunk: AIMessageChunk): string {
  const content = chunk.content
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
