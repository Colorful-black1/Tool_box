import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { access } from 'node:fs/promises'
import { join } from 'node:path'
import { IPC, WINDOW_EVENT } from '../../shared/ipc-contract'
import type { OpenCodeService } from '../services/opencode/opencode-service'
import { OpenCodeError } from '../services/opencode/opencode-error'
import type { CodingAgentService } from '../services/coding-agents/coding-agent-service'
import { CodingAgentError } from '../services/coding-agents/adapter'
import {
  optionalString,
  requireString,
  validateOpenCodeApproval,
  validateOpenCodeInput,
  validateOpenCodeOption
} from './validation'

/** 独立的新协议边界；系统异常不向 renderer 回显，权限只接受当前主窗口的请求。 */
export function registerOpenCodeIpc(service: OpenCodeService, unified?: CodingAgentService): void {
  const handle = (
    channel: string,
    action: (value: unknown) => unknown | Promise<unknown>
  ): void => {
    ipcMain.handle(channel, async (event, value: unknown) => {
      if (
        !BrowserWindow.fromWebContents(event.sender) ||
        event.senderFrame !== event.sender.mainFrame
      )
        throw new Error('当前页面无权使用编程工作台')
      try {
        return unified
          ? await unified.runLegacy(event.sender.id, channel, () => action(value))
          : await action(value)
      } catch (error) {
        throw new Error(
          error instanceof OpenCodeError || error instanceof CodingAgentError
            ? error.message
            : 'OpenCode 操作失败，请检查程序、项目目录及登录配置后重试',
          { cause: error }
        )
      }
    })
  }
  handle(IPC.opencodeInspect, () => service.inspect())
  handle(IPC.opencodeExecutable, async () => {
    const result = await dialog.showOpenDialog({
      title: '选择 OpenCode CLI 程序',
      properties: ['openFile'],
      filters: [
        { name: 'OpenCode CLI', extensions: process.platform === 'win32' ? ['exe'] : ['*'] }
      ]
    })
    return result.canceled || !result.filePaths[0]
      ? null
      : service.selectExecutable(result.filePaths[0])
  })
  handle(IPC.opencodeDirectory, async () => {
    const result = await dialog.showOpenDialog({
      title: '选择编程项目目录',
      properties: ['openDirectory']
    })
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })
  handle(IPC.opencodeConnect, (value) =>
    service.connect(requireString(value, '项目目录', { maxLength: 4096 }))
  )
  handle(IPC.opencodeDisconnect, () => service.disconnect())
  handle(IPC.opencodeSessions, () => service.listSessions())
  handle(IPC.opencodeSessionOpen, (value) =>
    service.openSession(optionalString(value, '编程会话', { maxLength: 200 }))
  )
  handle(IPC.opencodeOption, (value) => {
    const input = validateOpenCodeOption(value)
    return service.setOption(input.sessionId, input.optionId, input.value)
  })
  handle(IPC.opencodeSend, (value) => {
    const input = validateOpenCodeInput(value)
    return service.send(input.sessionId, input.content)
  })
  handle(IPC.opencodeStop, (value) =>
    service.stop(requireString(value, '编程会话', { maxLength: 200 }))
  )
  handle(IPC.opencodeApprove, (value) => {
    const input = validateOpenCodeApproval(value)
    service.approve(input.sessionId, input.approvalId, input.approved)
  })
  handle(IPC.opencodeDesktop, openOpenCodeDesktop)
  const unsubscribe = service.subscribe((event) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed() && (!unified || unified.ownsOpenCode(window.webContents.id)))
        window.webContents.send(WINDOW_EVENT.opencode, event)
    }
  })
  app.once('will-quit', () => {
    service.disconnect()
    unsubscribe()
  })
}

/** 保留已验证的 Desktop 外部入口，统一工作台与旧接口共用。 */
export async function openOpenCodeDesktop(): Promise<void> {
  const path =
    process.platform === 'win32' && process.env.LOCALAPPDATA
      ? join(process.env.LOCALAPPDATA, 'Programs', '@opencodedesktop', 'OpenCode.exe')
      : process.platform === 'darwin'
        ? '/Applications/OpenCode.app'
        : ''
  if (!path) throw new OpenCodeError('请通过系统应用入口打开 OpenCode Desktop')
  await access(path)
  if (await shell.openPath(path))
    throw new OpenCodeError('无法打开 OpenCode Desktop，请通过系统应用入口打开')
}
