import { BrowserWindow, ipcMain } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'

import type { AiAgentArenaQuery } from '../../shared/ai-agent-arena'
import { IPC } from '../../shared/ipc-contract'
import { AiAgentArenaError } from '../services/ai-agent-arena/errors'
import type { AiAgentArenaService } from '../services/ai-agent-arena/service'

function requireOwner(event: IpcMainInvokeEvent): void {
  if (!BrowserWindow.fromWebContents(event.sender) || event.senderFrame !== event.sender.mainFrame)
    throw new Error('当前页面无权读取 Agent 排行')
}

function validateQuery(value: unknown): AiAgentArenaQuery {
  if (value === undefined || value === null) return {}
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('查询参数格式不正确')
  const input = value as Record<string, unknown>
  return {
    allowStale: input.allowStale === true,
    force: input.force === true
  }
}

/** 只注册快照读取；抓取、解析和缓存全部留在主进程服务里。 */
export function registerAiAgentArenaIpc(service: AiAgentArenaService | undefined): void {
  if (!service) return
  ipcMain.handle(IPC.aiAgentArenaGet, async (event, input: unknown) => {
    requireOwner(event)
    const query = validateQuery(input)
    try {
      return await service.get(query)
    } catch (error) {
      if (error instanceof AiAgentArenaError) throw new Error(error.message, { cause: error })
      throw new Error('Agent 排行数据读取失败，请稍后重试', { cause: error })
    }
  })
}
