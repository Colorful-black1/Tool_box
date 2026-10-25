import { randomUUID } from 'node:crypto'
import { BrowserWindow, ipcMain } from 'electron'
import type { WebContents } from 'electron'
import { IPC, WINDOW_EVENT } from '../../shared/ipc-contract'
import type { AgentDraftService } from '../services/coding-agents/agent-draft-service'
import { validateAgentDraftSave, validateAgentDraftFlush } from './validation'

/** 刷新只接受被请求窗口的确认；超时后不声称已经保存。 */
export class AgentDraftQuitFlush {
  private pending: { owner: number; requestId: string; finish: (saved: boolean) => void } | null =
    null

  request(sender: WebContents): Promise<boolean> {
    if (sender.isDestroyed()) return Promise.resolve(false)
    return new Promise((resolve) => {
      const requestId = randomUUID()
      const timeout = setTimeout(() => finish(false), 2000)
      const finish = (saved: boolean): void => {
        clearTimeout(timeout)
        this.pending = null
        resolve(saved)
      }
      this.pending = { owner: sender.id, requestId, finish }
      try {
        sender.send(WINDOW_EVENT.agentDraftFlush, requestId)
      } catch {
        finish(false) /* 窗口可能在请求发出前已关闭，由退出流程提示。 */
      }
    })
  }

  acknowledge(owner: number, input: { requestId: string; saved: boolean }): void {
    if (this.pending?.owner !== owner || this.pending.requestId !== input.requestId)
      throw new Error('草稿刷新请求已失效')
    this.pending.finish(input.saved)
  }
}

export function registerAgentDraftsIpc(
  service: AgentDraftService,
  flush: AgentDraftQuitFlush
): void {
  const handle = (channel: string, action: (owner: number, value: unknown) => unknown): void => {
    ipcMain.handle(channel, (event, value: unknown) => {
      if (
        !BrowserWindow.fromWebContents(event.sender) ||
        event.senderFrame !== event.sender.mainFrame
      )
        throw new Error('当前页面无权使用草稿')
      return action(event.sender.id, value)
    })
  }
  handle(IPC.agentDraftRead, () => service.read())
  handle(IPC.agentDraftSave, (_owner, value) => service.save(validateAgentDraftSave(value)))
  handle(IPC.agentDraftFlushed, (owner, value) =>
    flush.acknowledge(owner, validateAgentDraftFlush(value))
  )
}
