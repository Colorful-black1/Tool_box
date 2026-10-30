import { describe, expect, it, vi } from 'vitest'
import { commandTools } from './commands'
import type { AgentDeps } from './deps'
import { buildLangChainTools, filterToolsByPermission } from '../tool-registry'
import type { AgentToolContext } from '../tool-registry'
import { DeveloperCommandService } from '../../developer-command-service'

function fixture() {
  let raw: string | null = null
  const store = {
    commandLibraryGet: () => raw,
    commandLibrarySet: vi.fn((value: string) => {
      raw = value
    })
  }
  const tools = commandTools({ store } as unknown as AgentDeps)
  const context: AgentToolContext = {
    conversationId: 'c1',
    notifyToolCall: () => undefined,
    notifyToolResult: () => undefined,
    requestApproval: async () => true
  }
  const service = new DeveloperCommandService(store)
  return { store, tools, context, service }
}
const input = {
  title: '自定义多行',
  command: '  echo "中文"\n\tprintf \'\\n\'  \n',
  category: 'Linux',
  shell: 'bash',
  risk: 'read'
}

describe('AI 对话命令速查工具', () => {
  it('只读只下发搜索，不下发新增；搜索内置与个人条目并排除归档', async () => {
    const { tools, context, service } = fixture()
    expect(filterToolsByPermission(tools, 'readonly').map((tool) => tool.name)).toEqual([
      'commands_search'
    ])
    const search = tools.find((tool) => tool.name === 'commands_search')!
    const native = (await search.handler({ query: '容器 日志' }, context)) as { total: number }
    expect(native.total).toBe(1)
    const id = service.save({
      ...input,
      shell: 'bash',
      risk: 'read',
      description: '',
      tags: [],
      expectedRevision: 0
    }).entries[0].id
    expect(await search.handler({ query: '自定义多行' }, context)).toMatchObject({ total: 1 })
    service.setArchived({ id, value: true, expectedRevision: 1 })
    expect(await search.handler({ query: '自定义多行' }, context)).toMatchObject({ total: 0 })
  })
  it('审批展示完整原文，通过后写入页面同源的库且不执行命令', async () => {
    const { tools, context, store, service } = fixture()
    const approve = vi.fn(async (event: { args: string }) => {
      expect(event.args).toContain(input.command)
      expect(event.args).toContain('仅保存，不执行命令')
      expect(store.commandLibrarySet).not.toHaveBeenCalled()
      return true
    })
    const tool = buildLangChainTools(tools, 'confirm', {
      ...context,
      requestApproval: approve
    }).find((item) => item.name === 'commands_create')!
    expect(await tool.invoke(input)).toContain('"created":true')
    expect(approve).toHaveBeenCalledOnce()
    expect(service.read().entries[0].command).toBe(input.command)
  })
  it('拒绝或审批期间停止均不写入', async () => {
    const { tools, context, store } = fixture()
    const rejected = buildLangChainTools(tools, 'confirm', {
      ...context,
      requestApproval: async () => false
    }).find((item) => item.name === 'commands_create')!
    expect(await rejected.invoke(input)).toContain('用户拒绝')
    const controller = new AbortController()
    const stopped = buildLangChainTools(tools, 'confirm', {
      ...context,
      signal: controller.signal,
      requestApproval: async () => {
        controller.abort()
        return true
      }
    }).find((item) => item.name === 'commands_create')!
    expect(await stopped.invoke(input)).toContain('停止')
    expect(store.commandLibrarySet).not.toHaveBeenCalled()
  })
  it('审批期间其他写入导致冲突，不覆盖也不静默重试', async () => {
    const { tools, context, service } = fixture()
    const tool = buildLangChainTools(tools, 'confirm', {
      ...context,
      requestApproval: async () => {
        service.save({
          title: '其他窗口',
          command: 'pwd',
          category: 'Linux',
          description: '',
          tags: [],
          shell: 'bash',
          risk: 'read',
          expectedRevision: 0
        })
        return true
      }
    }).find((item) => item.name === 'commands_create')!
    expect(await tool.invoke(input)).toContain('已变化')
    expect(service.read().entries.map((entry) => entry.title)).toEqual(['其他窗口'])
  })
  it('重复命令、空正文及试图带 ID 覆盖均在审批前拒绝', async () => {
    const { tools, context, store } = fixture()
    const create = tools.find((tool) => tool.name === 'commands_create')!
    await expect(
      create.prepare!({ title: '重复', command: 'docker ps -a' }, context)
    ).rejects.toThrow('已存在')
    await expect(create.prepare!({ title: '空白', command: '   ' }, context)).rejects.toThrow(
      '不能为空'
    )
    await expect(
      create.prepare!({ ...input, id: 'builtin:docker-containers' }, context)
    ).rejects.toThrow()
    expect(store.commandLibrarySet).not.toHaveBeenCalled()
  })
  it('搜索输出有界并明确标注长命令被截断，不能视为完整原文', async () => {
    const { tools, context, service } = fixture()
    service.save({
      title: '长命令',
      command: 'x'.repeat(2100),
      category: '其他',
      description: '',
      tags: [],
      shell: 'unspecified',
      risk: 'write',
      expectedRevision: 0
    })
    const result = (await tools[0].handler({ query: '长命令' }, context)) as {
      items: Array<{ command: string; commandTruncated: boolean }>
    }
    expect(result.items[0].command).toHaveLength(2000)
    expect(result.items[0].commandTruncated).toBe(true)
  })
})
