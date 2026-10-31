import { app, BrowserWindow, clipboard, ipcMain } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import { IPC, WINDOW_EVENT } from '../../shared/ipc-contract'
import { ClipboardHistoryService } from '../services/clipboard/clipboard-history'
import {
  requireString,
  validateClipboardConfig,
  validateClipboardPin,
  validateClipboardText
} from './validation'

export function requireCapabilityOwner(event: IpcMainInvokeEvent): BrowserWindow {
  const owner = BrowserWindow.fromWebContents(event.sender)
  if (!owner || event.senderFrame !== event.sender.mainFrame)
    throw new Error('当前页面无权使用本机工具')
  return owner
}

/** 仅记录纯文本格式；文件列表、HTML、RTF 与图片即使带文本回退也跳过。 */
export function registerClipboardIpc(): ClipboardHistoryService {
  const service = new ClipboardHistoryService(
    async () => {
      const items = await clipboard.read()
      const formats = items.flatMap((item) => item.types)
      if (formats.some((format) => /html|rtf|image|filename|hdrop|uri-list/i.test(format)))
        return ''
      const item = items.find((entry) => entry.types.includes('text/plain'))
      return item ? (await item.getType('text/plain')).text() : ''
    },
    () => BrowserWindow.getAllWindows().some((window) => !window.isDestroyed()),
    (snapshot) => {
      for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed()) window.webContents.send(WINDOW_EVENT.clipboard, snapshot)
      }
    }
  )
  ipcMain.handle(IPC.systemCopy, async (event, text: unknown) => {
    requireCapabilityOwner(event)
    const value = validateClipboardText(text)
    service.excludeCopy(value)
    await clipboard.writeText(value)
  })
  ipcMain.handle(IPC.clipboardList, (event) => {
    requireCapabilityOwner(event)
    return service.snapshot()
  })
  ipcMain.handle(IPC.clipboardEnabled, (event, value: unknown) => {
    requireCapabilityOwner(event)
    return service.configure(validateClipboardConfig(value))
  })
  ipcMain.handle(IPC.clipboardClear, (event, id: unknown) => {
    requireCapabilityOwner(event)
    return service.clear(
      id === undefined ? undefined : requireString(id, '记录标识', { maxLength: 64 })
    )
  })
  ipcMain.handle(IPC.clipboardPin, (event, value: unknown) => {
    requireCapabilityOwner(event)
    const input = validateClipboardPin(value)
    return service.pin(input.id, input.pinned)
  })
  ipcMain.handle(IPC.clipboardPause, (event) => {
    requireCapabilityOwner(event)
    return service.pause()
  })
  app.once('will-quit', () => service.dispose())
  return service
}
