import { create } from 'zustand'
import type { TodoInput, TodoQuery, TodoView } from '../../../shared/types'

export function emptyTodo(): TodoInput {
  return {
    title: '',
    details: '',
    priority: 'normal',
    startAtMs: null,
    dueAtMs: null,
    remind: true
  }
}

interface TodoState {
  items: TodoView[]
  total: number
  query: TodoQuery
  draft: TodoInput
  dirty: boolean
  loading: boolean
  busy: boolean
  error: string | null
  notificationStatus: string | null
  focusId: string | null
  setDraft(patch: Partial<TodoInput>): void
  edit(item?: TodoView): void
  setQuery(patch: Partial<TodoQuery>): void
  load(): Promise<void>
  save(): Promise<void>
  complete(id: string, completed: boolean): Promise<void>
  archive(id: string, archived: boolean): Promise<void>
  open(id: string | null): void
}

let request = 0

/** 编辑草稿跨页面保留在内存；旧查询不覆盖新筛选。 */
export const useTodoStore = create<TodoState>((set, get) => {
  const mutate = async (action: () => Promise<void>): Promise<void> => {
    if (get().busy) return
    if (!window.toolbox?.todos) {
      set({ error: '桌面桥接未就绪，暂时无法保存待办' })
      return
    }
    set({ busy: true, error: null })
    try {
      await action()
      await get().load()
    } catch (error) {
      set({ error: error instanceof Error ? error.message : '待办操作失败，请重试' })
    } finally {
      set({ busy: false })
    }
  }
  return {
    items: [],
    total: 0,
    query: { filter: 'all', search: '', offset: 0, limit: 30 },
    draft: emptyTodo(),
    dirty: false,
    loading: false,
    busy: false,
    error: null,
    notificationStatus: null,
    focusId: null,
    setDraft: (patch) => set((state) => ({ draft: { ...state.draft, ...patch }, dirty: true })),
    edit: (item) =>
      set({
        draft: item
          ? {
              id: item.id,
              title: item.title,
              details: item.details,
              priority: item.priority,
              startAtMs: item.startAtMs,
              dueAtMs: item.dueAtMs,
              remind: item.remind
            }
          : emptyTodo(),
        dirty: false
      }),
    setQuery: (patch) => {
      set((state) => ({
        focusId: null,
        query: { ...state.query, focusId: undefined, offset: 0, ...patch }
      }))
      void get().load()
    },
    load: async () => {
      const id = ++request
      if (!window.toolbox?.todos) {
        set({ error: '桌面桥接未就绪，暂时无法读取待办', loading: false })
        return
      }
      set({ loading: true })
      try {
        const result = await window.toolbox.todos.list(get().query)
        if (id !== request) return
        if (!result.items.length && result.total && get().query.offset > 0) {
          set((state) => ({
            query: {
              ...state.query,
              offset: Math.floor((result.total - 1) / state.query.limit) * state.query.limit
            }
          }))
          await get().load()
          return
        }
        set({
          items: result.items,
          total: result.total,
          notificationStatus: result.notificationStatus,
          error: null
        })
      } catch (error) {
        if (id === request)
          set({ error: error instanceof Error ? error.message : '无法读取待办，请刷新重试' })
      } finally {
        if (id === request) set({ loading: false })
      }
    },
    save: () =>
      mutate(async () => {
        const draft = get().draft
        await window.toolbox.todos.save(draft)
        // 新建后展示未完成列表，避免在已完成／搜索筛选中保存成功却找不到新事项。
        if (!draft.id)
          set({
            focusId: null,
            query: { ...get().query, filter: 'all', search: '', focusId: undefined, offset: 0 }
          })
        if (get().draft === draft) set({ draft: emptyTodo(), dirty: false })
      }),
    complete: (id, completed) => mutate(() => window.toolbox.todos.complete(id, completed)),
    archive: (id, archived) => mutate(() => window.toolbox.todos.archive(id, archived)),
    open: (id) => {
      set({
        focusId: id,
        query: { ...get().query, focusId: id ?? undefined, filter: 'all', search: '', offset: 0 }
      })
      void get().load()
    }
  }
})
