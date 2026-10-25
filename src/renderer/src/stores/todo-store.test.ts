import { beforeEach, describe, expect, it, vi } from 'vitest'
import { emptyTodo, useTodoStore } from './todo-store'
import type { TodoSnapshot } from '../../../shared/types'

const empty: TodoSnapshot = { items: [], total: 0, notificationStatus: null }

beforeEach(() => {
  useTodoStore.setState({
    draft: emptyTodo(),
    dirty: false,
    busy: false,
    loading: false,
    items: [],
    total: 0,
    error: null,
    query: { filter: 'all', search: '', offset: 0, limit: 30 }
  })
})

describe('待办渲染层状态', () => {
  it('在筛选中新增成功后展示新事项所在的未完成列表', async () => {
    const list = vi.fn(async () => empty)
    vi.stubGlobal('window', {
      toolbox: { todos: { list, save: vi.fn(async () => ({ id: 'new' })) } }
    })
    useTodoStore.setState({
      query: { filter: 'completed', search: '旧内容', focusId: 'old', offset: 30, limit: 30 }
    })
    useTodoStore.getState().setDraft({ title: '新事项' })
    await useTodoStore.getState().save()
    expect(useTodoStore.getState().query).toEqual({
      filter: 'all',
      search: '',
      focusId: undefined,
      offset: 0,
      limit: 30
    })
    expect(list).toHaveBeenLastCalledWith(useTodoStore.getState().query)
    expect(useTodoStore.getState().dirty).toBe(false)
  })
  it('保存失败保留草稿，重复点击不并发提交', async () => {
    let reject: ((reason: Error) => void) | undefined
    const save = vi.fn(
      () =>
        new Promise<never>((_resolve, fail) => {
          reject = fail
        })
    )
    vi.stubGlobal('window', { toolbox: { todos: { save, list: vi.fn(async () => empty) } } })
    useTodoStore.getState().setDraft({ title: '尚未保存' })
    const pending = useTodoStore.getState().save()
    await useTodoStore.getState().save()
    expect(save).toHaveBeenCalledOnce()
    reject?.(new Error('保存失败'))
    await pending
    expect(useTodoStore.getState().draft.title).toBe('尚未保存')
    expect(useTodoStore.getState().dirty).toBe(true)
    expect(useTodoStore.getState().busy).toBe(false)
  })
  it('旧查询延迟返回不会覆盖新筛选', async () => {
    let resolve: ((value: TodoSnapshot) => void) | undefined
    const list = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<TodoSnapshot>((done) => {
            resolve = done
          })
      )
      .mockResolvedValue(empty)
    vi.stubGlobal('window', { toolbox: { todos: { list } } })
    const old = useTodoStore.getState().load()
    useTodoStore.getState().setQuery({ search: '新的搜索' })
    await Promise.resolve()
    resolve?.({ ...empty, total: 99 })
    await old
    expect(useTodoStore.getState().query.search).toBe('新的搜索')
    expect(useTodoStore.getState().total).toBe(0)
  })
})
