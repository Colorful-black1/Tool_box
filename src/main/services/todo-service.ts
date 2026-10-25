import type { TodoInput, TodoQuery, TodoSnapshot, TodoView } from '../../shared/types'
import type { ToolboxStore } from './chat-store/chat-store'

/** 页面和 Agent 共用写入口，确保刷新与通知调度不因调用来源而分叉。 */
export class TodoService {
  private changed: () => void = () => undefined
  private status: () => string | null = () => null

  constructor(private readonly store: ToolboxStore) {}

  private run<T>(action: () => T): T {
    try {
      return action()
    } catch (error) {
      console.warn('[Todo] 待办数据操作失败', {
        error: error instanceof Error ? error.name : 'unknown'
      })
      throw new Error('待办数据暂时无法访问，请刷新后重试', { cause: error })
    }
  }

  setNotifications(changed: () => void, status: () => string | null): void {
    this.changed = changed
    this.status = status
  }

  list(query: TodoQuery): TodoSnapshot {
    return { ...this.run(() => this.store.listTodos(query)), notificationStatus: this.status() }
  }

  get(id: string): TodoView {
    const item = this.run(() =>
      this.store.listTodos({
        focusId: id,
        filter: 'all',
        search: '',
        offset: 0,
        limit: 1
      })
    ).items[0]
    if (!item) throw new Error('待办不存在，请重新查询')
    return item
  }

  save(input: TodoInput): TodoView {
    const saved = this.run(() => this.store.saveTodo(input))
    this.changed()
    return saved
  }

  complete(id: string, completed: boolean): void {
    this.run(() => this.store.completeTodo(id, completed))
    this.changed()
  }

  archive(id: string, archived: boolean): void {
    this.run(() => this.store.archiveTodo(id, archived))
    this.changed()
  }
}
