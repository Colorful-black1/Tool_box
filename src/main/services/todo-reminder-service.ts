import type { ToolboxStore } from './chat-store/chat-store'

/** 系统通知由入口注入，测试不调用真实 Windows 通知。 */
export interface TodoNotification {
  title: string
  body: string
  shown(): void
  failed(): void
  clicked(): void
  closed(): void
}

interface ReminderDependencies {
  store: Pick<ToolboxStore, 'pendingTodoReminders' | 'markTodoReminders'>
  supported(): boolean
  show(input: TodoNotification): () => void
  changed(): void
  open(id: string | null): void
  now?: () => number
}

/** 主进程调度在窗口隐藏后仍运行；只有系统确认显示才写去重标记。 */
export class TodoReminderService {
  private timer: ReturnType<typeof setInterval> | null = null
  private pending = false
  private stopped = false
  private nextAttemptAt = 0
  private lastTestAt = -Infinity
  private readonly active = new Set<() => void>()
  private failure: string | null = null

  constructor(private readonly deps: ReminderDependencies) {}

  status(): string | null {
    return this.deps.supported() ? this.failure : '当前系统不支持桌面通知；待办仍可正常使用'
  }

  start(): void {
    if (this.timer) return
    this.stopped = false
    this.timer = setInterval(() => this.check(), 30000)
    this.check()
  }

  check(): void {
    const now = this.deps.now?.() ?? Date.now()
    if (this.stopped || this.pending || now < this.nextAttemptAt || !this.deps.supported()) return
    try {
      const reminders = this.deps.store.pendingTodoReminders(now)
      if (!reminders.length) return
      this.pending = true
      const first = reminders[0]
      const title =
        reminders.length > 1
          ? `有 ${reminders.length} 项待办需要处理`
          : first.kind === 'due'
            ? '待办已到截止时间'
            : '待办可以开始了'
      const body =
        first.title.slice(0, 120) +
        (reminders.length > 1 ? ` 等 ${reminders.length} 项，点击查看` : '')
      void this.deliver(title, body, reminders.length === 1 ? first.id : null)
        .then(() => {
          if (!this.stopped) this.deps.store.markTodoReminders(reminders)
        })
        .catch(() => {
          // 系统显示失败或写去重状态失败，保留未提醒记录并限速重试。
          this.failure = '提醒未能确认送达，请检查 Windows 通知设置；应用会稍后重试'
          this.nextAttemptAt = now + 60000
          console.warn('待办提醒未能确认送达')
        })
        .finally(() => {
          this.pending = false
          if (!this.stopped) this.deps.changed()
        })
    } catch {
      this.failure = '待办提醒检查失败，请重新打开应用'
      this.nextAttemptAt = now + 60000
      console.warn('待办提醒检查失败')
      this.deps.changed()
    }
  }

  async test(): Promise<void> {
    const now = this.deps.now?.() ?? Date.now()
    if (now - this.lastTestAt < 10000) throw new Error('请稍后再测试通知')
    this.lastTestAt = now
    await this.deliver('待办提醒测试', '收到此通知表示系统通知可用；点击可打开待办清单', null)
    this.deps.changed()
  }

  stop(): void {
    this.stopped = true
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    for (const close of this.active) close()
    this.active.clear()
  }

  private deliver(title: string, body: string, id: string | null): Promise<void> {
    if (!this.deps.supported()) return Promise.reject(new Error('当前系统不支持桌面通知'))
    return new Promise((resolve, reject) => {
      let settled = false
      let closeNative: (() => void) | undefined
      const timeout = setTimeout(() => {
        fail()
        closeNative?.()
      }, 10000)
      const close = (): void => {
        clearTimeout(timeout)
        if (!settled) fail()
        closeNative?.()
        this.active.delete(close)
      }
      const fail = (): void => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        this.failure = '通知未能显示，请检查 Windows 通知设置和免打扰状态'
        this.active.delete(close)
        closeNative?.()
        reject(new Error(this.failure))
      }
      this.active.add(close)
      try {
        closeNative = this.deps.show({
          title,
          body,
          shown: () => {
            if (settled || this.stopped) return
            settled = true
            clearTimeout(timeout)
            this.failure = null
            resolve()
          },
          failed: fail,
          clicked: () => {
            if (!this.stopped) this.deps.open(id)
          },
          closed: () => {
            clearTimeout(timeout)
            if (!settled) fail()
            this.active.delete(close)
          }
        })
      } catch {
        fail()
        this.active.delete(close)
      }
    })
  }
}
