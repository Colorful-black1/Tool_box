import { BrowserWindow, ipcMain } from 'electron'

import { IPC } from '../../shared/ipc-contract'
import { ExtensionError } from '../../shared/extensions'
import type { ExtensionsService } from '../services/extensions/service'
import {
  validateExtensionListInput,
  validateMcpSearchInput,
  validateSkillRootPath,
  validateSkillSearchInput
} from './validation'

/**
 * 注册技能与 MCP 的只读通道。
 *
 * 服务缺失时直接跳过，旧版本渲染层仍能启动；所有错误收敛成用户可读文案，
 * 不把路径、堆栈或配置内容带出去。
 */
export function registerExtensionsIpc(service: ExtensionsService | undefined): void {
  if (!service) return

  const handle = (channel: string, action: (value: unknown) => Promise<unknown>): void => {
    ipcMain.handle(channel, async (event, value: unknown) => {
      if (
        !BrowserWindow.fromWebContents(event.sender) ||
        event.senderFrame !== event.sender.mainFrame
      )
        throw new Error('当前页面无权读取技能与 MCP')
      try {
        return await action(value)
      } catch (error) {
        throw new Error(
          error instanceof ExtensionError ? error.message : '无法读取技能或 MCP 信息，请稍后重试',
          { cause: error }
        )
      }
    })
  }

  handle(IPC.skillHubList, async (value) => {
    const { refresh } = validateExtensionListInput(value)
    return service.listSkills(refresh)
  })
  handle(IPC.skillHubSearch, async (value) => service.searchSkills(validateSkillSearchInput(value)))
  handle(IPC.mcpHubList, async (value) => {
    const { refresh } = validateExtensionListInput(value)
    return service.listMcp(refresh)
  })
  handle(IPC.mcpHubSearch, async (value) => service.searchMcp(validateMcpSearchInput(value)))
  handle(IPC.skillHubRootsList, async () => service.skillRoots())
  handle(IPC.skillHubRootsAdd, async (value) => service.addSkillRoot(validateSkillRootPath(value)))
  handle(IPC.skillHubRootsRemove, async (value) =>
    service.removeSkillRoot(validateSkillRootPath(value))
  )
}
