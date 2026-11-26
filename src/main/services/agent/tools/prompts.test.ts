import { describe, expect, it, vi } from 'vitest'

import { defaultPromptTemplates } from '../../../../shared/prompt-tools'
import type { PromptTemplate } from '../../../../shared/prompt-tools'
import { buildLangChainTools, filterToolsByPermission } from '../tool-registry'
import type { AgentToolContext, AgentToolDefinition } from '../tool-registry'
import type { AgentDeps } from './deps'
import { promptTools } from './prompts'

function fixture(config: Record<string, unknown> | null = null) {
  let current = config
  const store = {
    configGet: () => current,
    configSet: vi.fn((patch: Record<string, unknown>) => {
      current = { ...(current ?? {}), ...patch }
      return current
    })
  }
  const tools = promptTools({ store } as unknown as AgentDeps)
  const context: AgentToolContext = {
    conversationId: 'c1',
    notifyToolCall: () => undefined,
    notifyToolResult: () => undefined,
    requestApproval: async () => true
  }
  return {
    store,
    tools,
    context,
    setConfig: (next: Record<string, unknown> | null): void => {
      current = next
    },
    read: (): PromptTemplate[] =>
      (current?.promptTemplates as PromptTemplate[] | undefined) ?? defaultPromptTemplates()
  }
}

function find(tools: AgentToolDefinition[], name: string): AgentToolDefinition {
  const tool = tools.find((item) => item.name === name)
  if (!tool) throw new Error(`缺少工具 ${name}`)
  return tool
}

describe('AI 对话 Prompt 模板工具', () => {
  it('空配置时列出 5 个内置模板，且不返回正文', async () => {
    const { tools, context } = fixture()
    const result = (await find(tools, 'prompts_list').handler({}, context)) as {
      total: number
      templates: Array<Record<string, unknown>>
    }
    expect(result.total).toBe(5)
    expect(result.templates[0]).toMatchObject({ id: 'builtin-java-error' })
    expect(result.templates[0]).not.toHaveProperty('body')
  })

  it('读取当前模板与指定历史版本', async () => {
    const { tools, context } = fixture()
    const get = find(tools, 'prompts_get')
    const current = (await get.handler({ id: 'builtin-code-review' }, context)) as {
      body: string
      variables: string[]
      updatedAtMs: number
    }
    expect(current.body).toContain('{{context}}')
    expect(current.variables).toEqual(['context'])

    const prepared = await find(tools, 'prompts_save').prepare!(
      {
        id: 'builtin-code-review',
        title: '代码审查',
        body: '新正文 {{context}}',
        expectedUpdatedAtMs: current.updatedAtMs
      },
      context
    )
    await prepared.execute()

    const history = (await get.handler({ id: 'builtin-code-review', version: 0 }, context)) as {
      body: string
    }
    expect(history.body).toContain('{{context}}')
    expect(history.body).not.toBe('新正文 {{context}}')
  })

  it('按变量生成最终提示词，缺变量时报错', async () => {
    const { tools, context } = fixture()
    const render = find(tools, 'prompts_render')
    const result = (await render.handler(
      { id: 'builtin-code-review', values: { context: '这段代码' } },
      context
    )) as { output: string }
    expect(result.output).toContain('这段代码')
    await expect(
      render.handler({ id: 'builtin-code-review', values: {} }, context)
    ).rejects.toThrow('context')
  })

  it('新建与更新模板，保留历史版本且内容未变不新增', async () => {
    const { tools, context, read } = fixture()
    const save = find(tools, 'prompts_save')
    const get = find(tools, 'prompts_get')

    const created = await save.prepare!({ title: '我的模板', body: '请总结 {{text}}' }, context)
    const createdResult = (await created.execute()) as { created: boolean; id: string }
    expect(createdResult.created).toBe(true)
    expect(read()).toHaveLength(6)

    const current = (await get.handler({ id: createdResult.id }, context)) as {
      updatedAtMs: number
    }
    const updated = await save.prepare!(
      {
        id: createdResult.id,
        title: '我的模板',
        body: '请总结 {{text}}，并列出风险',
        expectedUpdatedAtMs: current.updatedAtMs
      },
      context
    )
    expect((await updated.execute()) as { versionCount: number }).toMatchObject({
      versionCount: 1
    })

    const latest = (await get.handler({ id: createdResult.id }, context)) as {
      updatedAtMs: number
    }
    const unchanged = await save.prepare!(
      {
        id: createdResult.id,
        title: '我的模板',
        body: '请总结 {{text}}，并列出风险',
        expectedUpdatedAtMs: latest.updatedAtMs
      },
      context
    )
    expect((await unchanged.execute()) as { unchanged: boolean }).toMatchObject({
      unchanged: true
    })
    expect(read().find((item) => item.id === createdResult.id)?.versions).toHaveLength(1)
  })

  it('渲染工具通过 LangChain 调用也能处理变量映射', async () => {
    const { tools, context } = fixture()
    const render = buildLangChainTools(tools, 'readonly', context).find(
      (item) => item.name === 'prompts_render'
    )!
    expect(
      await render.invoke({ id: 'builtin-code-review', values: { context: '代码' } })
    ).toContain('代码')
  })

  it('更新必须带 updatedAtMs', async () => {
    const { tools, context } = fixture()
    await expect(
      find(tools, 'prompts_save').prepare!(
        { id: 'builtin-code-review', title: 'x', body: 'y' },
        context
      )
    ).rejects.toThrow('updatedAtMs')
  })

  it('审批期间模板被修改则拒绝覆盖', async () => {
    const { tools, context, read, setConfig } = fixture()
    const prepared = await find(tools, 'prompts_save').prepare!(
      {
        id: 'builtin-code-review',
        title: '代码审查',
        body: '新正文 {{context}}',
        expectedUpdatedAtMs: 0
      },
      context
    )
    setConfig({
      promptTemplates: read().map((item) =>
        item.id === 'builtin-code-review' ? { ...item, updatedAtMs: 99 } : item
      )
    })
    await expect(prepared.execute()).rejects.toThrow('已被修改')
  })

  it('模板数量达到上限时拒绝新建', async () => {
    const templates: PromptTemplate[] = Array.from({ length: 20 }, (_, index) => ({
      id: `t-${index}`,
      title: `模板 ${index}`,
      body: '正文',
      updatedAtMs: 0,
      versions: []
    }))
    const { tools, context } = fixture({ promptTemplates: templates })
    await expect(
      find(tools, 'prompts_save').prepare!({ title: '第 21 个', body: '正文' }, context)
    ).rejects.toThrow('上限')
  })

  it('模板与历史总量超限时在审批前拒绝', async () => {
    const body = 'x'.repeat(10_100)
    const templates: PromptTemplate[] = Array.from({ length: 17 }, (_, index) => ({
      id: `t-${index}`,
      title: `模板 ${index}`,
      body,
      updatedAtMs: 0,
      versions: []
    }))
    const { tools, context } = fixture({ promptTemplates: templates })
    await expect(
      find(tools, 'prompts_save').prepare!({ title: '超限', body }, context)
    ).rejects.toThrow('总量')
  })

  it('配置损坏时给出可读错误，不用默认模板覆盖', async () => {
    const { tools, context, store } = fixture({ promptTemplates: 'bad' })
    await expect(find(tools, 'prompts_list').handler({}, context)).rejects.toThrow('配置无效')
    expect(store.configSet).not.toHaveBeenCalled()
  })

  it('只读档位不下发保存工具', () => {
    const { tools } = fixture()
    expect(filterToolsByPermission(tools, 'readonly').map((tool) => tool.name)).toEqual([
      'prompts_list',
      'prompts_get',
      'prompts_render'
    ])
  })

  it('保存必须审批；拒绝不写入，完全访问也不跳过确认', async () => {
    const { tools, context, store } = fixture()
    const denied = buildLangChainTools(tools, 'confirm', {
      ...context,
      requestApproval: async () => false
    }).find((tool) => tool.name === 'prompts_save')!
    expect(await denied.invoke({ title: '未保存', body: '正文' })).toContain('用户拒绝')
    expect(store.configSet).not.toHaveBeenCalled()

    const approve = vi.fn(async () => true)
    const full = buildLangChainTools(tools, 'full', {
      ...context,
      requestApproval: approve
    }).find((tool) => tool.name === 'prompts_save')!
    await full.invoke({ title: '已保存', body: '正文' })
    expect(approve).toHaveBeenCalledOnce()
  })
})
