import { randomUUID } from 'node:crypto'
import { lstat, realpath } from 'node:fs/promises'
import { resolve } from 'node:path'
import { dialog, ipcMain } from 'electron'
import { IPC, WINDOW_EVENT } from '../../shared/ipc-contract'
import { findDuplicateFiles } from '../services/files/duplicate-finder'
import { requireCapabilityOwner } from './clipboard-ipc'
import { requireString } from './validation'

/** 目录引用绑定窗口，十分钟有效；渲染层无法提供任意文件路径。 */
export function registerFileToolsIpc(): void {
  const choices = new Map<number, { token: string; directory: string; expires: number }>()
  const scans = new Map<number, { id: string; abort: AbortController }>()
  const watched = new Set<number>()
  ipcMain.handle(IPC.filesChooseDirectory, async (event) => {
    const owner = requireCapabilityOwner(event)
    const result = await dialog.showOpenDialog(owner, {
      title: '选择查重目录（只读）',
      properties: ['openDirectory']
    })
    if (result.canceled || !result.filePaths[0] || event.sender.isDestroyed()) return null
    const directory = resolve(result.filePaths[0])
    const stat = await lstat(directory)
    if (stat.isSymbolicLink() || !stat.isDirectory() || (await realpath(directory)) !== directory)
      throw new Error('请选择普通目录，不能使用符号链接或联接目录')
    const token = randomUUID()
    choices.set(owner.id, { token, directory, expires: Date.now() + 10 * 60_000 })
    if (!watched.has(owner.id)) {
      watched.add(owner.id)
      owner.once('closed', () => {
        choices.delete(owner.id)
        scans.get(owner.id)?.abort.abort()
        scans.delete(owner.id)
        watched.delete(owner.id)
      })
    }
    return { token, label: directory }
  })
  ipcMain.handle(IPC.filesFindDuplicates, async (event, input: unknown) => {
    const owner = requireCapabilityOwner(event)
    const token = requireString(input, '目录引用', { maxLength: 64 })
    const choice = choices.get(owner.id)
    if (!choice || choice.token !== token || choice.expires < Date.now())
      throw new Error('目录选择已失效，请重新选择')
    if (scans.has(owner.id)) throw new Error('已有扫描正在进行，请先取消')
    const id = randomUUID()
    const abort = new AbortController()
    scans.set(owner.id, { id, abort })
    try {
      return await findDuplicateFiles(choice.directory, id, abort.signal, (snapshot) => {
        if (!event.sender.isDestroyed()) event.sender.send(WINDOW_EVENT.fileScan, snapshot)
      })
    } finally {
      if (scans.get(owner.id)?.id === id) scans.delete(owner.id)
    }
  })
  ipcMain.handle(IPC.filesCancelScan, (event) => {
    const owner = requireCapabilityOwner(event)
    scans.get(owner.id)?.abort.abort()
  })
}
