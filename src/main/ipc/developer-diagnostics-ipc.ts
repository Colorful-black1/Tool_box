import { BrowserWindow, ipcMain } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import { IPC } from '../../shared/ipc-contract'
import { inspectCertificates, listPortProcesses } from '../services/developer-diagnostics'
import { validateCertificateInput } from './validation'

/** 只接受受管窗口的顶层 frame，渲染层没有系统命令或文件路径入口。 */
function requireOwner(event: IpcMainInvokeEvent): void {
  if (!BrowserWindow.fromWebContents(event.sender) || event.senderFrame !== event.sender.mainFrame)
    throw new Error('当前页面无权使用本机诊断工具')
}

export function registerDeveloperDiagnosticsIpc(): void {
  ipcMain.handle(IPC.toolsCertificateInspect, (event, input: unknown) => {
    requireOwner(event)
    return inspectCertificates(validateCertificateInput(input))
  })
  ipcMain.handle(IPC.systemNetworkPorts, (event) => {
    requireOwner(event)
    return listPortProcesses()
  })
}
