import { ipcMain, shell } from 'electron'

import { IPC } from '../../shared/ipc-contract'
import type { GithubTrendingService } from '../services/github-trending/service'
import { describeTrendingError } from '../services/github-trending/fetch'
import { validateRepoFullName, validateTrendingQuery } from './validation'

/** 注册热榜通道；服务缺失时保持旧版本页面可用，不抛启动错误。 */
export function registerTrendingIpc(service: GithubTrendingService | undefined): void {
  if (!service) return

  ipcMain.handle(IPC.trendingList, async (_event, input: unknown) => {
    const query = validateTrendingQuery(input)
    try {
      return await service.list(query)
    } catch (error) {
      throw new Error(describeTrendingError(error), { cause: error })
    }
  })

  ipcMain.handle(IPC.trendingOpen, async (_event, fullName: unknown) => {
    const name = validateRepoFullName(fullName)
    try {
      await shell.openExternal(`https://github.com/${name}`)
    } catch (error) {
      throw new Error('无法打开浏览器，请检查系统默认浏览器设置', { cause: error })
    }
  })
}
