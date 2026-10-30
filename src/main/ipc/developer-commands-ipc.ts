import { BrowserWindow, ipcMain } from 'electron'
import { IPC } from '../../shared/ipc-contract'
import type { ToolboxStore } from '../services/chat-store/chat-store'
import { DeveloperCommandService } from '../services/developer-command-service'
import { validateDeveloperCommandInput, validateDeveloperCommandToggle } from './validation'

/** 只接受受管窗口顶层 frame，不暴露任意 kv 键或系统执行入口。 */
export function registerDeveloperCommandsIpc(store: ToolboxStore): void {
  const service = new DeveloperCommandService(store)
  const methods = [
    [IPC.developerCommandsRead, () => service.read()],
    [
      IPC.developerCommandsSave,
      (input: unknown) => service.save(validateDeveloperCommandInput(input))
    ],
    [
      IPC.developerCommandsFavorite,
      (input: unknown) => service.setFavorite(validateDeveloperCommandToggle(input))
    ],
    [
      IPC.developerCommandsArchive,
      (input: unknown) => service.setArchived(validateDeveloperCommandToggle(input))
    ]
  ] as const
  for (const [channel, action] of methods) {
    ipcMain.handle(channel, (event, input: unknown) => {
      if (
        !BrowserWindow.fromWebContents(event.sender) ||
        event.senderFrame !== event.sender.mainFrame
      )
        throw new Error('当前页面无权使用命令速查')
      return action(input)
    })
  }
}
