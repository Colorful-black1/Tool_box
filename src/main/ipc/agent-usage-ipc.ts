import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { readFile, rename, writeFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { IPC } from '../../shared/ipc-contract'
import { USAGE_CLIENTS } from '../../shared/agent-usage'
import type { UsageClient } from '../../shared/agent-usage'
import { AgentUsageService } from '../services/agent-usage/usage-service'
import { readUsageCache, writeUsageCache } from '../services/agent-usage/cache'
import { object } from '../services/agent-usage/normalize'
import { validateUsageClient, validateUsageQuery } from './validation'

/** 仅持久化用户选择的来源路径，Token 缓存仅在内存中，不改变业务数据库。 */
export function registerAgentUsageIpc(): void {
  const settingsFile = join(app.getPath('userData'), 'agent-usage-sources.json')
  const cacheFile = join(app.getPath('userData'), 'agent-usage-cache.json')
  const service = (async () => {
    const roots: Partial<Record<UsageClient, string>> = {}
    try {
      const data = object(JSON.parse(await readFile(settingsFile, 'utf8')) as unknown)
      for (const id of Object.keys(USAGE_CLIENTS) as UsageClient[]) {
        const path = data[id]
        if (typeof path === 'string' && path.length <= 4096 && isAbsolute(path)) roots[id] = path
      }
    } catch (error) {
      // 缺失是首次使用；损坏设置保留原文件，仅本次回退自动发现，不回显内容。
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        console.warn('[AgentUsage] 来源设置不可读，使用自动发现')
    }
    return new AgentUsageService(
      roots,
      async (value) => {
        await writeFile(settingsFile + '.tmp', JSON.stringify(value), {
          encoding: 'utf8',
          mode: 0o600
        })
        await rename(settingsFile + '.tmp', settingsFile)
      },
      {
        load: () => readUsageCache(cacheFile),
        save: async (value) => {
          await writeUsageCache(cacheFile, value)
        }
      }
    )
  })()
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
