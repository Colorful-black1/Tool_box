import { BrowserWindow, ipcMain, shell } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'

import type { AiWorldQuery } from '../../shared/ai-model-world'
import { IPC } from '../../shared/ipc-contract'
import type { AiWorldService } from '../services/ai-model-world/service'
import { requireString } from './validation'

function requireOwner(event: IpcMainInvokeEvent): void {
  if (!BrowserWindow.fromWebContents(event.sender) || event.senderFrame !== event.sender.mainFrame)
    throw new Error('当前页面无权读取 AI 模型数据')
}

function validateQuery(value: unknown): AiWorldQuery {
  if (value === undefined || value === null) return {}
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('查询参数格式不正确')
  const input = value as Record<string, unknown>
  return {
    allowStale: input.allowStale === true,
    force: input.force === true
  }
}

/** 只注册快照读取与来源打开；所有网络请求留在主进程服务里。 */
export function registerAiWorldIpc(service: AiWorldService | undefined): void {
  if (!service) return

  ipcMain.handle(IPC.aiWorldGet, async (event, input: unknown) => {
    requireOwner(event)
    try {
      return await service.get(validateQuery(input))
    } catch (error) {
      throw new Error('AI 模型数据读取失败，请稍后重试', { cause: error })
    }
  })

  ipcMain.handle(IPC.aiWorldOpenSource, async (event, input: unknown) => {
    requireOwner(event)
    const url = requireString(input, '来源链接', { maxLength: 2048 })
    if (!service.isKnownSource(url)) throw new Error('该链接不在当前数据来源中')
    await shell.openExternal(url)
  })
}
