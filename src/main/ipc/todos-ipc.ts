import { app, BrowserWindow, ipcMain, Notification, powerMonitor } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import { IPC, WINDOW_EVENT } from '../../shared/ipc-contract'
import type { TodoEvent } from '../../shared/types'
import type { ToolboxStore } from '../services/chat-store/chat-store'
import { TodoReminderService } from '../services/todo-reminder-service'
import { TodoService } from '../services/todo-service'
import { showMainWindow } from '../tray'
import {
  requireString,
  requireTodoBoolean,
  validateTodoInput,
  validateTodoQuery
} from './validation'

/** 新能力只向受管窗口主 frame 开放，所有业务输入统一校验。 */
export function registerTodosIpc(store: ToolboxStore, service = new TodoService(store)): void {
  const broadcast = (event: TodoEvent): void => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send(WINDOW_EVENT.todo, event)
    }
  }
  const reminders = new TodoReminderService({
    store,
    supported: () => Notification.isSupported(),
    changed: () => broadcast({ type: 'changed' }),
    open: (id) => {
      const win = BrowserWindow.getAllWindows()[0]
      if (!win) return
      showMainWindow(win)
      broadcast({ type: 'open', id })
    },
    show: (input) => {
      const notification = new Notification({ title: input.title, body: input.body })
      notification.once('show', input.shown)
      notification.once('failed', input.failed)
      notification.once('click', input.clicked)
      notification.once('close', input.closed)
      notification.show()
      return () => {
        notification.removeAllListeners()
        notification.close()
      }
    }
  })
  const owner = (event: IpcMainInvokeEvent): void => {
    if (
      !BrowserWindow.fromWebContents(event.sender) ||
      event.senderFrame !== event.sender.mainFrame
    )
      throw new Error('当前页面无权访问待办')
  }
  const changed = (): void => {
    broadcast({ type: 'changed' })
    reminders.check()
  }
  service.setNotifications(changed, () => reminders.status())
  ipcMain.handle(IPC.todosList, (event, query: unknown) => {
    owner(event)
    const valid = validateTodoQuery(query)
    try {
      return service.list(valid)
    } catch {
      throw new Error('无法读取待办，请刷新重试')
    }
  })
  ipcMain.handle(IPC.todosSave, (event, input: unknown) => {
    owner(event)
    const valid = validateTodoInput(input)
    try {
      return service.save(valid)
    } catch {
      throw new Error('待办保存失败，请刷新确认或重试')
    }
  })
  ipcMain.handle(IPC.todosComplete, (event, id: unknown, completed: unknown) => {
    owner(event)
    const validId = requireString(id, '待办 ID', { maxLength: 64 })
    const validState = requireTodoBoolean(completed)
    try {
      service.complete(validId, validState)
    } catch {
      throw new Error('无法更新完成状态，请刷新重试')
    }
  })
  ipcMain.handle(IPC.todosArchive, (event, id: unknown, archived: unknown) => {
    owner(event)
    const validId = requireString(id, '待办 ID', { maxLength: 64 })
    const validState = requireTodoBoolean(archived)
    try {
      service.archive(validId, validState)
    } catch {
      throw new Error('无法更新归档状态，请刷新重试')
    }
  })
  ipcMain.handle(IPC.todosNotificationTest, (event) => {
    owner(event)
    return reminders.test()
  })
  const resume = (): void => reminders.check()
  powerMonitor.on('resume', resume)
  // 窗口先初始化，再检查过期提醒；真正退出时释放，取消退出不停止服务。
  const start = setTimeout(() => reminders.start(), 1500)
  app.once('will-quit', () => {
    clearTimeout(start)
    powerMonitor.removeListener('resume', resume)
    reminders.stop()
  })
}
