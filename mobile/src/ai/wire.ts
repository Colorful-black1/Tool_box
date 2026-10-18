/**
 * OpenAI 兼容「线路层」的形状，以及流式工具调用的拼接。
 *
 * 为什么单独一个文件：`sse.ts` 只管 SSE 分帧与文本增量；而工具调用的
 * `arguments` 是**分片到达的 JSON 字符串**，必须按 index 拼起来才能解析。
 * 这是手机端 Agent 里最容易出错的一段，拆出来单独可测。
 *
 * 与桌面端的差异：桌面端把这一段交给 LangChain / openai SDK，
 * 手机端不搬 LangChain（Metro 只解析 mobile/node_modules），因此自己实现。
 *
 * 本文件不 import 任何 Node / RN 模块，可在 vitest 中直接跑。
 */
import { firstChoice } from './sse'

/** 发给模型的工具声明（OpenAI function calling 形状） */
export interface ToolSchema {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

/** 模型请求的一次工具调用；`arguments` 是**未经解析**的原始 JSON 字符串 */
export interface WireToolCall {
  id: string
  name: string
  arguments: string
}

/**
 * 一次请求里的消息。
 *
 * 比 `ChatMessage` 宽：工具轮次需要 `assistant.tool_calls` 与 `tool` 结果两条消息，
 * 它们**只存在于本次请求的临时数组里，不落库**（与桌面端一致：不接 checkpointer）。
 */
export interface WireMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  /** 仅 assistant：本轮请求的工具调用 */
  toolCalls?: WireToolCall[]
  /** 仅 tool：对应哪一次 tool_call */
  toolCallId?: string
}

/** 一条 tool_calls 增量 */
export interface ToolCallDelta {
  index: number
  id?: string
  name?: string
  argumentsDelta?: string
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

/**
 * 从一条流式负载里取出 tool_calls 增量。
 *
 * 形状：`choices[0].delta.tool_calls` 是数组，元素形如
 * `{index, id?, type?, function: {name?, arguments?}}`。
 * - `index` 决定这是第几个并行调用；部分网关单调用时省略它，此时按数组下标兜底。
 * - `arguments` 是**片段**，必须由调用方拼接（见 `ToolCallAccumulator`）。
 */
export function extractToolCallDeltas(payload: unknown): ToolCallDelta[] {
  const choice = firstChoice(payload)
  if (!choice) return []

  const delta = choice['delta']
  if (typeof delta !== 'object' || delta === null) return []
  const calls = (delta as Record<string, unknown>)['tool_calls']
  if (!Array.isArray(calls)) return []

  const out: ToolCallDelta[] = []
  calls.forEach((raw, position) => {
    if (typeof raw !== 'object' || raw === null) return
    const entry = raw as Record<string, unknown>
    const fn = entry['function']
    const fnRecord = typeof fn === 'object' && fn !== null ? (fn as Record<string, unknown>) : {}
    out.push({
      index: typeof entry['index'] === 'number' ? entry['index'] : position,
      id: readString(entry['id']),
      // 名称按「非空即覆盖」处理：多数网关只在首个增量给出完整名称，
      // 也有网关每个增量都重复一次完整名称；拼接会导致 'notes_listnotes_list'。
      name: readString(fnRecord['name']),
      argumentsDelta: readString(fnRecord['arguments'])
    })
  })
  return out
}

/**
 * 把一条流里所有 tool_calls 增量拼成完整的调用。
 *
 * 只累加 `arguments`：它是模型逐字符吐出的 JSON，跨 chunk 与跨事件都会断开，
 * 中途还常夹着空增量与 `finish_reason`，因此必须按 index 累积而不是覆盖。
 */
export class ToolCallAccumulator {
  private readonly parts = new Map<number, { id: string; name: string; args: string }>()

  push(payload: unknown): void {
    for (const delta of extractToolCallDeltas(payload)) {
      const current = this.parts.get(delta.index) ?? { id: '', name: '', args: '' }
      if (delta.id) current.id = delta.id
      if (delta.name) current.name = delta.name
      if (delta.argumentsDelta) current.args += delta.argumentsDelta
      this.parts.set(delta.index, current)
    }
  }

  get size(): number {
    return this.parts.size
  }

  /** 按 index 升序返回，保证并行调用的顺序稳定 */
  list(): WireToolCall[] {
    return [...this.parts.entries()]
      .sort((left, right) => left[0] - right[0])
      .map(([, part]) => ({ id: part.id, name: part.name, arguments: part.args }))
  }
}

/** 把内部消息序列化成请求体里的形状 */
export function toWireMessage(message: WireMessage): Record<string, unknown> {
  const body: Record<string, unknown> = { role: message.role, content: message.content }
  if (message.toolCalls && message.toolCalls.length > 0) {
    body['tool_calls'] = message.toolCalls.map((call) => ({
      id: call.id,
      type: 'function',
      function: { name: call.name, arguments: call.arguments }
    }))
  }
  if (message.toolCallId) body['tool_call_id'] = message.toolCallId
  return body
}
