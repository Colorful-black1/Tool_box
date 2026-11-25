import { BrowserWindow, ipcMain } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'

import type { AiWorldAaQuery } from '../../shared/ai-world-aa'
import { IPC } from '../../shared/ipc-contract'
import type { AiWorldAaKeyService } from '../services/ai-world-aa/key-service'
import type { AiWorldAaService } from '../services/ai-world-aa/service'
import { AiWorldAaError } from '../services/ai-world-aa/errors'
import { assertObject, requireString } from './validation'

function requireOwner(event: IpcMainInvokeEvent): void {
  if (!BrowserWindow.fromWebContents(event.sender) || event.senderFrame !== event.sender.mainFrame)
    throw new Error('当前页面无权读取 Artificial Analysis 数据')
}

function validateQuery(value: unknown): AiWorldAaQuery {
  if (value === undefined || value === null) return {}
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('查询参数格式不正确')
  const input = value as Record<string, unknown>
  return {
    allowStale: input.allowStale === true,
    force: input.force === true
  }
}

function keyError(error: unknown): Error {
  if (error instanceof AiWorldAaError) return new Error(error.message, { cause: error })
  return new Error('API Key 保存失败，请稍后重试', { cause: error })
}

/** AA 榜读取与 Key 管理；Key 明文只停留在主进程内存。 */
export function registerAiWorldAaIpc(
  service: AiWorldAaService | undefined,
  keyService: AiWorldAaKeyService | undefined
): void {
  if (!service || !keyService) return

  ipcMain.handle(IPC.aiWorldAaGet, async (event, input: unknown) => {
    requireOwner(event)
    const query = validateQuery(input)
    try {
      return await service.get(query)
    } catch (error) {
      if (error instanceof AiWorldAaError)
        throw new Error(error.message, { cause: error })
      throw new Error('Artificial Analysis 数据读取失败，请稍后重试', { cause: error })
    }
  })

  ipcMain.handle(IPC.aiWorldAaKeyStatus, (event) => {
    requireOwner(event)
    return keyService.status()
  })

  ipcMain.handle(IPC.aiWorldAaKeySave, (event, input: unknown) => {
    requireOwner(event)
    const body = assertObject(input, 'API Key 参数')
    const apiKey = requireString(body.apiKey, 'API Key', { maxLength: 256 })
    try {
      return keyService.saveKey(apiKey)
    } catch (error) {
      throw keyError(error)
    }
  })

  ipcMain.handle(IPC.aiWorldAaKeyClear, (event) => {
    requireOwner(event)
    try {
      return keyService.clearKey()
    } catch (error) {
      throw new Error('清除 API Key 失败，请稍后重试', { cause: error })
    }
  })
}
