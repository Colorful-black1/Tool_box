import { describe, expect, it } from 'vitest'
import * as z from 'zod'

import {
  buildLangChainTools,
  collectAgentTools,
  filterToolsByPermission
} from './tool-registry'
import type { AgentToolContext, AgentToolDefinition } from './tool-registry'

function def(name: string, risk: AgentToolDefinition['risk']): AgentToolDefinition {
  return {
    name,
    description: name,
    schema: z.object({}),
    risk,
    handler: async () => 'ok'
  }
}

const tools: AgentToolDefinition[] = [
  def('books_list', 'read'),
  def('books_delete', 'destructive'),
  def('notes_save', 'write')
]

describe('filterToolsByPermission', () => {
  it('readonly 只保留只读工具', () => {
    const result = filterToolsByPermission(tools, 'readonly')
    expect(result.map((tool) => tool.name)).toEqual(['books_list'])
  })

  it('confirm 与 full 暴露全部工具（confirm 在执行期再拦截）', () => {
    expect(filterToolsByPermission(tools, 'confirm')).toHaveLength(3)
    expect(filterToolsByPermission(tools, 'full')).toHaveLength(3)
  })
})

describe('collectAgentTools', () => {
  it('拒绝重复工具名', () => {
    expect(() => collectAgentTools([def('a', 'read'), def('a', 'write')])).toThrow(
      /重复的 Agent 工具名/
    )
  })
})

describe('buildLangChainTools 的结果摘要', () => {
  function context(sink: string[]): AgentToolContext {
    return {
      conversationId: 'c1',
      notifyToolCall: () => undefined,
      notifyToolResult: (event) => sink.push(event.summary),
      requestApproval: async () => true
    }
  }

  it('默认摘要不回显原始对象（不泄露数据库字段）', async () => {
    const summaries: string[] = []
    const tool: AgentToolDefinition = {
      name: 'x',
      description: 'x',
      schema: z.object({}),
      risk: 'read',
      handler: async () => ({ id: 'secret-id-123', createdAtMs: 42 })
    }
    const [built] = buildLangChainTools([tool], 'full', context(summaries))
    await built.invoke({})
    expect(summaries.join('')).not.toContain('secret-id-123')
    expect(summaries.join('')).not.toContain('42')
  })

  it('自定义 summarize 决定展示文案', async () => {
    const summaries: string[] = []
    const tool: AgentToolDefinition = {
      name: 'x',
      description: 'x',
      schema: z.object({}),
      risk: 'read',
      summarize: (_input, result) => `已处理《${(result as { title: string }).title}》`,
      handler: async () => ({ id: 'secret-id-123', title: '凡人修仙传' })
    }
    const [built] = buildLangChainTools([tool], 'full', context(summaries))
    await built.invoke({})
    expect(summaries.join('')).toBe('已处理《凡人修仙传》')
    expect(summaries.join('')).not.toContain('secret-id-123')
  })
})
