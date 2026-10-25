import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TodoInput, TodoQuery, TodoView } from '../../../../shared/types'
import type { ToolboxStore } from '../../chat-store/chat-store'
import { TodoService } from '../../todo-service'
import { todoTools } from './todos'
import type { AgentDeps } from './deps'
import type { AgentToolContext } from '../tool-registry'
import { buildLangChainTools } from '../tool-registry'

let row: TodoView
const notify = vi.fn()
const save = vi.fn((input: TodoInput) => {
  row = { ...row, ...input, id: input.id ?? 't2' }
  return { ...row }
})
const list = vi.fn((_query: TodoQuery) => ({ items: [{ ...row }], total: 1 }))
const complete = vi.fn((_id: string, state: boolean) => {
  row.completedAtMs = state ? 10 : null
})
const archive = vi.fn((_id: string, state: boolean) => {
  row.archivedAtMs = state ? 10 : null
})
const service = new TodoService({
  listTodos: list,
  saveTodo: save,
  completeTodo: complete,
  archiveTodo: archive
} as unknown as ToolboxStore)
service.setNotifications(notify, () => '合成通知状态')
const deps = { todos: service } as AgentDeps
const ctx: AgentToolContext = {
  conversationId: 'c1',
  notifyToolCall: () => undefined,
  notifyToolResult: () => undefined,
  requestApproval: async () => true
}
const find = (name: string) => todoTools(deps).find((tool) => tool.name === name)!

beforeEach(() => {
  vi.clearAllMocks()
  row = {
    id: 't1',
    title: '发布',
    details: '保留备注',
    priority: 'high',
    startAtMs: 100,
    dueAtMs: 200,
    remind: true,
    completedAtMs: null,
    archivedAtMs: null,
    createdAtMs: 0,
    updatedAtMs: 1
  }
})
describe('对话待办与同源服务', () => {
  it('更新未传字段保留、null 清除日期，并触发统一提醒刷新', async () => {
    await find('todos_save').handler({ id: 't1', title: '新版发布', start: null }, ctx)
    expect(row).toMatchObject({
      title: '新版发布',
      details: '保留备注',
      priority: 'high',
      startAtMs: null,
      dueAtMs: 200
    })
    expect(notify).toHaveBeenCalledOnce()
  })
  it('拒绝非法日期、时间缺失、反向区间和超限分页', async () => {
    for (const start of ['2026-02-30 12:00', '2026-10-25', '2026-10-25 25:00'])
      await expect(find('todos_save').handler({ title: '新建', start }, ctx)).rejects.toThrow()
    await expect(
      find('todos_save').handler(
        { title: '新建', start: '2026-10-26 12:00', due: '2026-10-25 12:00' },
        ctx
      )
    ).rejects.toThrow('晚于')
    await expect(find('todos_list').handler({ limit: 101 }, ctx)).rejects.toThrow('分页')
    expect(save).not.toHaveBeenCalled()
  })
  it('确认期间其他编辑不会被覆盖', async () => {
    const prepared = await find('todos_save').prepare!({ id: 't1', title: '修改' }, ctx)
    row.details = '用户更新'
    await expect(prepared.execute()).rejects.toThrow('已被修改')
    expect(save).not.toHaveBeenCalled()
  })
  it('四种状态操作均更新原对象并触发提醒检查', async () => {
    const [tool] = buildLangChainTools([find('todos_set_state')], 'confirm', ctx)
    for (const action of ['complete', 'reopen', 'archive', 'restore'])
      await tool.invoke({ id: 't1', action })
    expect(complete.mock.calls.map((call) => call[1])).toEqual([true, false])
    expect(archive.mock.calls.map((call) => call[1])).toEqual([true, false])
    expect(notify).toHaveBeenCalledTimes(4)
  })
  it('新建不猜测已有事项；拒绝审批不写入', async () => {
    const [tool] = buildLangChainTools([find('todos_save')], 'confirm', {
      ...ctx,
      requestApproval: async () => false
    })
    await tool.invoke({ title: '发布' })
    expect(save).not.toHaveBeenCalled()
    expect(notify).not.toHaveBeenCalled()
  })
})
