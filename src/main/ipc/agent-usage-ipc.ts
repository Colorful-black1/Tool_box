import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { IPC } from '../../shared/ipc-contract'
import { USAGE_CLIENTS } from '../../shared/agent-usage'
import type { AgentUsageService } from '../services/agent-usage/usage-service'
import { createAgentUsageService } from '../services/agent-usage/create-service'
import { validateUsageClient, validateUsageQuery } from './validation'

/** 来源路径与元数据缓存由共用服务管理，不改变业务数据库。 */
export function registerAgentUsageIpc(
  service: Promise<AgentUsageService> = createAgentUsageService(app.getPath('userData'))
): void {
  const handle = (channel: string, action: (value: unknown) => Promise<unknown>): void => {
    ipcMain.handle(channel, async (event, value: unknown) => {
      if (
        !BrowserWindow.fromWebContents(event.sender) ||
        event.senderFrame !== event.sender.mainFrame
      )
        throw new Error('当前页面无权读取用量统计')
      try {
        return await action(value)
      } catch {
        throw new Error('无法读取用量统计，请核对筛选条件和数据来源后重试')
      }
    })
  }
  handle(IPC.agentUsageQuery, async (value) => (await service).query(validateUsageQuery(value)))
  handle(IPC.agentUsageChooseSource, async (value) => {
    const client = validateUsageClient(value)
    const database = ['opencode', 'zcode', 'mimocode', 'mcode', 'copilot'].includes(client)
    const result = await dialog.showOpenDialog({
      title: `选择 ${USAGE_CLIENTS[client]} ${database ? '用量数据库' : '会话目录'}`,
      properties: database ? ['openFile'] : ['openDirectory'],
      ...(database
        ? { filters: [{ name: 'SQLite 数据库', extensions: ['db', 'sqlite', 'sqlite3'] }] }
        : {})
    })
    if (result.canceled || !result.filePaths[0]) return false
    await (await service).chooseSource(client, result.filePaths[0])
    return true
  })
  handle(IPC.agentUsageResetSource, async (value) =>
    (await service).chooseSource(validateUsageClient(value), null)
  )
}
