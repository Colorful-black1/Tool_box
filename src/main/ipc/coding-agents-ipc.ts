import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { IPC, WINDOW_EVENT } from '../../shared/ipc-contract'
import type { CodingAgentService } from '../services/coding-agents/coding-agent-service'
import { CodingAgentError } from '../services/coding-agents/adapter'
import { OpenCodeError } from '../services/opencode/opencode-error'
import { openOpenCodeDesktop } from './opencode-ipc'
import {
  CodingAgentValidationError,
  validateCodingAgentApproval,
  validateCodingAgentConnect,
  validateCodingAgentId,
  validateCodingAgentOption,
  validateCodingAgentSend,
  validateCodingAgentSession
} from './validation'

/** 新通道保留窗口 / frame 检查，原生事件只投递连接所有者。 */
export function registerCodingAgentsIpc(service: CodingAgentService): void {
  const owners = new Set<number>()
  const handle = (channel: string, action: (owner: number, input: unknown) => unknown): void => {
    ipcMain.handle(channel, async (event, input: unknown) => {
      if (
        !BrowserWindow.fromWebContents(event.sender) ||
        event.senderFrame !== event.sender.mainFrame
      )
        throw new Error('当前页面无权使用编程工作台')
      const owner = event.sender.id
      if (!owners.has(owner)) {
        owners.add(owner)
        event.sender.once('destroyed', () => {
          service.releaseOwner(owner)
          owners.delete(owner)
        })
      }
      try {
        return await action(owner, input)
      } catch (error) {
        const message =
          error instanceof CodingAgentError ||
          error instanceof OpenCodeError ||
          error instanceof CodingAgentValidationError
            ? error.message
            : 'Agent 操作失败，请检查程序、项目目录和原生登录状态'
        throw new Error(message.slice(0, 300), { cause: error })
      }
    })
  }
  handle(IPC.codingAgentRuntimes, (owner) => service.listRuntimes(owner))
  handle(IPC.codingAgentInspect, (owner, value) =>
    service.inspect(validateCodingAgentId(value), owner)
  )
  handle(IPC.codingAgentExecutable, async (owner, value) => {
    const id = validateCodingAgentId(value)
    const info = await service.inspect(id, owner)
    if (!info.available) throw new CodingAgentError(info.detail)
    const result = await dialog.showOpenDialog({
      title: `选择 ${info.name} 原生 CLI 程序`,
      properties: ['openFile'],
      filters: [
        {
          name: '原生运行程序',
          extensions:
            process.platform === 'win32' ? (id === 'dsh' ? ['exe', 'cmd'] : ['exe']) : ['*']
        }
      ]
    })
    return result.canceled || !result.filePaths[0]
      ? null
      : service.selectExecutable(id, owner, result.filePaths[0])
  })
  handle(IPC.codingAgentDirectory, async () => {
    const result = await dialog.showOpenDialog({
      title: '选择编程项目目录',
      properties: ['openDirectory']
    })
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })
  handle(IPC.codingAgentConnect, (owner, value) => {
    const input = validateCodingAgentConnect(value)
    return service.connect(input.runtimeId, owner, input.directory)
  })
  handle(IPC.codingAgentDisconnect, (owner, value) =>
    service.disconnect(validateCodingAgentId(value), owner)
  )
  handle(IPC.codingAgentSessions, (owner, value) =>
    service.listSessions(validateCodingAgentId(value), owner)
  )
  handle(IPC.codingAgentCreate, (owner, value) =>
    service.openSession(validateCodingAgentId(value), owner)
  )
  handle(IPC.codingAgentResume, (owner, value) => {
    const input = validateCodingAgentSession(value)
    return service.openSession(input.runtimeId, owner, input.sessionId)
  })
  handle(IPC.codingAgentOption, (owner, value) => {
    const input = validateCodingAgentOption(value)
    return service.setOption(input.runtimeId, owner, input.sessionId, input.optionId, input.value)
  })
  handle(IPC.codingAgentSend, (owner, value) => {
    const input = validateCodingAgentSend(value)
    return service.send(input.runtimeId, owner, input.sessionId, input.content)
  })
  handle(IPC.codingAgentStop, (owner, value) => {
    const input = validateCodingAgentSession(value)
    return service.stop(input.runtimeId, owner, input.sessionId)
  })
  handle(IPC.codingAgentApprove, (owner, value) => {
    const input = validateCodingAgentApproval(value)
    return service.approve(
      input.runtimeId,
      owner,
      input.sessionId,
      input.approvalId,
      input.approved
    )
  })
  handle(IPC.codingAgentDesktop, (_owner, value) => {
    if (validateCodingAgentId(value) !== 'opencode')
      throw new CodingAgentError('请通过系统应用入口打开对应 Agent，桌面会话可见性尚未验证')
    return openOpenCodeDesktop()
  })
  const dispose = service.subscribe((owner, event) => {
    const window = BrowserWindow.getAllWindows().find(
      (item) =>
        !item.isDestroyed() && !item.webContents.isDestroyed() && item.webContents.id === owner
    )
    if (window) window.webContents.send(WINDOW_EVENT.codingAgent, event)
  })
  app.once('will-quit', () => {
    // 断开适配器会同步发布终态；退出时先撤销已失效的窗口订阅。
    dispose()
    service.dispose()
  })
}
