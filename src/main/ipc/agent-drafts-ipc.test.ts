import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WebContents } from 'electron'
import { IPC, WINDOW_EVENT } from '../../shared/ipc-contract'
import { AgentDraftQuitFlush, registerAgentDraftsIpc } from './agent-drafts-ipc'
import { AgentDraftService } from '../services/coding-agents/agent-draft-service'

const harness = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, value?: unknown) => unknown>(),
  managed: true
}))
vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, callback: (event: unknown, value?: unknown) => unknown) =>
      harness.handlers.set(channel, callback)
  },
  BrowserWindow: { fromWebContents: () => (harness.managed ? {} : null) }
}))

beforeEach(() => {
  harness.handlers.clear()
  harness.managed = true
})

describe('草稿 IPC 与退出刷新', () => {
  it('只允许受管窗口主 frame，校验保存载荷后才访问服务', () => {
    const service = new AgentDraftService(
      { agentDraftCipherGet: () => null, agentDraftCipherSet: vi.fn() },
      { encryptText: (text) => text, decryptText: (text) => text }
    )
    const save = vi.spyOn(service, 'save')
    registerAgentDraftsIpc(service, new AgentDraftQuitFlush())
    const frame = {}
    const event = { sender: { id: 1, mainFrame: frame }, senderFrame: frame }
    const read = harness.handlers.get(IPC.agentDraftRead)!
    expect(read(event)).toMatchObject({ revision: 0 })
    harness.managed = false
    expect(() => read(event)).toThrow('无权')
    harness.managed = true
    expect(() => read({ ...event, senderFrame: {} })).toThrow('无权')
    expect(() => harness.handlers.get(IPC.agentDraftSave)!(event, { revision: -1 })).toThrow()
    expect(save).not.toHaveBeenCalled()
  })
  it('确认必须匹配窗口和请求，迟到确认无效；超时返回未保存', async () => {
    vi.useFakeTimers()
    try {
      const flush = new AgentDraftQuitFlush()
      const send = vi.fn()
      const sender = { id: 7, isDestroyed: () => false, send } as unknown as WebContents
      const pending = flush.request(sender)
      const [channel, requestId] = send.mock.calls[0]
      expect(channel).toBe(WINDOW_EVENT.agentDraftFlush)
      expect(() => flush.acknowledge(8, { requestId, saved: true })).toThrow('失效')
      flush.acknowledge(7, { requestId, saved: true })
      expect(await pending).toBe(true)
      expect(() => flush.acknowledge(7, { requestId, saved: true })).toThrow('失效')
      const timeout = flush.request(sender)
      await vi.advanceTimersByTimeAsync(2000)
      expect(await timeout).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })
})
