import { randomUUID } from 'node:crypto'

import { tool as createLangChainTool } from 'langchain'
import type { StructuredToolInterface } from '@langchain/core/tools'
import { z } from 'zod'

import type { AgentPermission, AgentToolRisk } from '../../../shared/types'

/** 工具调用摘要的最大长度，避免大对象把事件撑爆 */
const ARGS_PREVIEW_CHARS = 400

/**
 * 工具执行上下文：由 agent-runner 按会话注入，
 * 负责把工具调用过程回推给渲染层，并在需要时等待用户批准。
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
  schema: z.ZodObject<z.ZodRawShape>
  risk: AgentToolRisk
  handler: (input: Record<string, unknown>, ctx: AgentToolContext) => Promise<unknown>
  /**
   * 结果的人类可读摘要，用于界面展示。
   * 禁止暴露数据库内部字段（id、时间戳等原始对象）——缺省时只显示「完成」。
   */
  summarize?: (input: Record<string, unknown>, result: unknown) => string
}

/** 收集全部工具声明（各域工具文件在此汇总） */
export function collectAgentTools(definitions: AgentToolDefinition[]): AgentToolDefinition[] {
  const seen = new Set<string>()
  for (const definition of definitions) {
    if (seen.has(definition.name)) {
      throw new Error(`重复的 Agent 工具名：${definition.name}`)
    }
    seen.add(definition.name)
  }
  return definitions
}

/** 按权限档位过滤：readonly 只保留只读工具 */
export function filterToolsByPermission(
  definitions: AgentToolDefinition[],
  permission: AgentPermission
): AgentToolDefinition[] {
  if (permission === 'readonly') {
    return definitions.filter((definition) => definition.risk === 'read')
  }
  return definitions
}

/**
 * 把声明式工具转成 LangChain 工具：包一层调用过程上报 + 审批门。
 * - 每次调用生成稳定的 callId，供 UI 匹配「开始 / 结果 / 审批」；
 * - confirm 档位下，写 / 破坏性工具执行前先请求用户批准；
 * - 结果统一序列化为字符串回给模型（工具返回值必须是字符串）。
 */
export function buildLangChainTools(
  definitions: AgentToolDefinition[],
  permission: AgentPermission,
  ctx: AgentToolContext
): StructuredToolInterface[] {
  return definitions.map((definition) =>
    createLangChainTool(
      async (input: Record<string, unknown>): Promise<string> => {
        const callId = randomUUID()
        const args = summarise(input, ARGS_PREVIEW_CHARS)
        ctx.notifyToolCall({ callId, name: definition.name, args })

        if (permission === 'confirm' && definition.risk !== 'read') {
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
          const result = await definition.handler(input, ctx)
          const summary = definition.summarize
            ? definition.summarize(input, result)
            : '完成'
          ctx.notifyToolResult({ callId, ok: true, summary })
          return stringify(result)
        } catch (error) {
          const message = error instanceof Error ? error.message : '工具执行失败'
          ctx.notifyToolResult({ callId, ok: false, summary: message })
          return `工具执行失败：${message}`
        }
      },
      {
        name: definition.name,
        description: definition.description,
        schema: definition.schema
      }
    )
  )
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

function summarise(value: unknown, maxChars: number): string {
  if (value === undefined || value === null) return ''
  let text: string
  if (typeof value === 'string') {
    text = value
  } else {
    try {
      text = JSON.stringify(value)
    } catch {
      text = String(value)
    }
  }
  return text.length > maxChars ? `${text.slice(0, maxChars)}…` : text
}
