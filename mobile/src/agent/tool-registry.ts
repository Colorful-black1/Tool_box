/**
 * Agent 工具注册表（手机端）。
 *
 * 与桌面端 `services/agent/tool-registry.ts` 的职责相同：声明式工具 → 执行包装
 * （callId、审批门、过程上报）。差异只有两点，都是手机端约束决定的：
 * - **不用 zod**：Metro 只解析 `mobile/node_modules`，为 8 个工具引一个 schema 库不划算，
 *   因此 `parameters` 手写 JSON Schema，入参校验用下面几个 `require*` / `optional*` 帮手。
 * - **不包 LangChain 工具**：手机端自写循环（见 `agent-loop.ts`），这里只暴露纯函数。
 *
 * 本文件不 import 任何 RN / Node 模块，可在 vitest 中直接测。
 */
import type { ToolSchema } from '../ai/wire'
import type { AgentPermission, AgentToolRisk } from '../shared-bridge'

/** 工具调用摘要上限，避免大对象把事件撑爆（与桌面端一致） */
const ARGS_PREVIEW_CHARS = 400

/**
 * 工具执行上下文：由 agent-loop 按会话注入，
 * 负责把过程回推给界面，并在需要时等用户批准。
 */
export interface AgentToolContext {
  conversationId: string
  notifyToolCall(event: { callId: string; name: string; args: string }): void
  notifyToolResult(event: { callId: string; ok: boolean; summary: string }): void
  requestApproval(event: {
    callId: string
    name: string
    args: string
    risk: AgentToolRisk
  }): Promise<boolean>
}

/** 一个可被 AI 接管的工具声明（新增能力只需注册一条） */
export interface AgentToolDefinition {
  name: string
  description: string
  /** 手写 JSON Schema，只声明参数形状；真正的校验在 handler 里做 */
  parameters: Record<string, unknown>
  risk: AgentToolRisk
  handler: (input: Record<string, unknown>, ctx: AgentToolContext) => Promise<unknown>
  /**
   * 结果的人类可读摘要，用于界面展示。
   * 禁止暴露数据库内部字段（id、时间戳等原始对象）——缺省时只显示「完成」。
   */
  summarize?: (input: Record<string, unknown>, result: unknown) => string
}

/** 收拢各域工具，重名直接抛错（新增工具域时最容易犯的错） */
export function collectTools(groups: AgentToolDefinition[][]): AgentToolDefinition[] {
  const seen = new Set<string>()
  const all: AgentToolDefinition[] = []
  for (const group of groups) {
    for (const definition of group) {
      if (seen.has(definition.name)) {
        throw new Error(`重复的 Agent 工具名：${definition.name}`)
      }
      seen.add(definition.name)
      all.push(definition)
    }
  }
  return all
}

/**
 * 按权限档位过滤工具。
 *
 * 只读档位下**根本不下发**写工具，而不是下发了再拒绝：模型看不到工具就不会去调，
 * 省掉一整轮无效往返，也让「只读」这件事在提示词之外有硬保证。
 */
export function filterToolsByPermission(
  definitions: AgentToolDefinition[],
  permission: AgentPermission
): AgentToolDefinition[] {
  if (permission === 'readonly') {
    return definitions.filter((definition) => definition.risk === 'read')
  }
  return definitions
}

/** 转成请求体里的工具声明 */
export function toToolSchemas(definitions: AgentToolDefinition[]): ToolSchema[] {
  return definitions.map((definition) => ({
    type: 'function' as const,
    function: {
      name: definition.name,
      description: definition.description,
      parameters: definition.parameters
    }
  }))
}

/** 执行一次工具：上报 → 审批 → 执行 → 上报，返回给模型的字符串 */
export async function runTool(input: {
  definition: AgentToolDefinition
  callId: string
  rawArguments: string
  permission: AgentPermission
  ctx: AgentToolContext
}): Promise<string> {
  const { definition, callId, ctx } = input
  const args = truncate(input.rawArguments, ARGS_PREVIEW_CHARS)
  ctx.notifyToolCall({ callId, name: definition.name, args })

  // 第二道闸：即使调用方忘了过滤工具，只读档位也不会真的执行写操作
  if (input.permission === 'readonly' && definition.risk !== 'read') {
    ctx.notifyToolResult({ callId, ok: false, summary: '当前权限为只读，该操作不可用' })
    return '当前权限为只读，该操作不可用。请告知用户切换到更高的权限档位。'
  }

  if (input.permission === 'confirm' && definition.risk !== 'read') {
    const approved = await ctx.requestApproval({
      callId,
      name: definition.name,
      args,
      risk: definition.risk
    })
    if (!approved) {
      ctx.notifyToolResult({ callId, ok: false, summary: '用户已拒绝该操作' })
      return '用户拒绝了该操作，请不要重试，改用其他方式或向用户说明。'
    }
  }

  try {
    const parsed = parseArguments(input.rawArguments)
    const result = await definition.handler(parsed, ctx)
    const summary = definition.summarize ? definition.summarize(parsed, result) : '完成'
    ctx.notifyToolResult({ callId, ok: true, summary })
    return stringify(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : '工具执行失败'
    ctx.notifyToolResult({ callId, ok: false, summary: message })
    return `工具执行失败：${message}`
  }
}

/**
 * 解析模型给的入参。
 *
 * `arguments` 是模型逐字符生成的 JSON，拼错是常事（尤其被截断时），
 * 这里报可读错误交给模型自己修正，而不是让整个会话崩掉。
 */
function parseArguments(rawArguments: string): Record<string, unknown> {
  const text = rawArguments.trim()
  if (!text) return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('入参不是合法 JSON，请重新生成参数')
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('入参必须是 JSON 对象')
  }
  return parsed as Record<string, unknown>
}

function stringify(value: unknown): string {
  if (value === undefined) return 'ok'
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return 'ok'
  }
}

function truncate(value: string, maxChars: number): string {
  return value.length > maxChars ? `${value.slice(0, maxChars)}…` : value
}

// ==================== 入参校验帮手 ====================
// 语义与桌面端 zod 上的 .max() 对齐：长度上限既防注入，也防把上下文撑爆。

export function requireText(
  input: Record<string, unknown>,
  key: string,
  label: string,
  maxChars: number
): string {
  const raw = input[key]
  if (typeof raw !== 'string' || !raw.trim()) throw new Error(`请提供${label}`)
  const value = raw.trim()
  if (value.length > maxChars) throw new Error(`${label}过长（上限 ${maxChars} 字符）`)
  return value
}

export function optionalText(
  input: Record<string, unknown>,
  key: string,
  label: string,
  maxChars: number
): string | undefined {
  const raw = input[key]
  if (raw === undefined || raw === null || raw === '') return undefined
  if (typeof raw !== 'string') throw new Error(`${label}必须是文本`)
  const value = raw.trim()
  if (!value) return undefined
  if (value.length > maxChars) throw new Error(`${label}过长（上限 ${maxChars} 字符）`)
  return value
}

export function requireInt(
  input: Record<string, unknown>,
  key: string,
  label: string,
  min: number,
  max: number
): number {
  const raw = input[key]
  const value = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isInteger(value)) throw new Error(`${label}必须是整数`)
  if (value < min || value > max) throw new Error(`${label}超出范围（${min} ~ ${max}）`)
  return value
}

export function optionalInt(
  input: Record<string, unknown>,
  key: string,
  label: string,
  min: number,
  max: number
): number | undefined {
  const raw = input[key]
  if (raw === undefined || raw === null || raw === '') return undefined
  return requireInt(input, key, label, min, max)
}

/** JSON Schema 片段：字符串参数 */
export function textParam(description: string, maxChars: number): Record<string, unknown> {
  return { type: 'string', description, maxLength: maxChars }
}

/** JSON Schema 片段：整数参数 */
export function intParam(description: string, min: number, max: number): Record<string, unknown> {
  return { type: 'integer', description, minimum: min, maximum: max }
}
