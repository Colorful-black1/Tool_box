import { BrowserWindow, dialog, ipcMain } from 'electron'

import { IPC, WINDOW_EVENT } from '../../shared/ipc-contract'
import type { KbProgressEvent } from '../../shared/knowledge-base'
import type { KnowledgeBaseService } from '../services/knowledge-base/kb-service'
import {
  validateKbDocumentId,
  validateKbDocumentInput,
  validateKbImportInput,
  validateKbListInput,
  validateKbSearchInput
} from './validation'

/**
 * 知识库通道：沿用编程工作台的窗口 / 主 frame 检查。
 * 导入与重建的进度只回推给发起请求的窗口，不广播。
 */
export function registerKnowledgeIpc(service: KnowledgeBaseService): void {
  const handle = (
    channel: string,
    action: (input: unknown, sender: Electron.WebContents) => unknown
  ): void => {
    ipcMain.handle(channel, async (event, input: unknown) => {
      if (
        !BrowserWindow.fromWebContents(event.sender) ||
        event.senderFrame !== event.sender.mainFrame
      )
        throw new Error('当前页面无权使用知识库')
      try {
        return await action(input, event.sender)
      } catch (error) {
        const message = error instanceof Error ? error.message : '知识库操作失败，请稍后重试'
        throw new Error(message.slice(0, 300), { cause: error })
      }
    })
  }

  const progress = (sender: Electron.WebContents) => (event: KbProgressEvent): void => {
    if (!sender.isDestroyed()) sender.send(WINDOW_EVENT.kbProgress, event)
  }

  handle(IPC.kbList, (value) => service.list(validateKbListInput(value)))

  handle(IPC.kbImport, async (value, sender) => {
    const input = validateKbImportInput(value)
    let paths = input.paths
    if (!paths) {
      const owner = BrowserWindow.fromWebContents(sender)
      const result = await dialog.showOpenDialog({
        title: '导入资料',
        properties: ['openFile', 'multiSelections'],
        filters: [{ name: 'Markdown 或文本', extensions: ['md', 'txt'] }],
        ...(owner ? { window: owner } : {})
      })
      if (result.canceled || result.filePaths.length === 0) return null
      paths = result.filePaths
    }
    return service.importPaths(paths, {
      category: input.category,
      onProgress: progress(sender)
    })
  })

  handle(IPC.kbReindex, (value, sender) =>
    service.reindex(validateKbDocumentId(value), { onProgress: progress(sender) })
  )

  handle(IPC.kbRemove, (value) => {
    service.remove(validateKbDocumentId(value))
  })

  handle(IPC.kbSearch, (value) => service.search(validateKbSearchInput(value)))

  handle(IPC.kbDocument, (value) => {
    const input = validateKbDocumentInput(value)
    return service.detail(input.documentId, input.chunkId)
  })
}
