import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC, WINDOW_EVENT } from '../../shared/ipc-contract'
import type { CodingAgentService } from '../services/coding-agents/coding-agent-service'
import { registerCodingAgentsIpc } from './coding-agents-ipc'

const mock = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, value?: unknown) => Promise<unknown>>(),
  fromWebContents: vi.fn(),
  send: vi.fn(),
  otherSend: vi.fn()
}))
vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (event: unknown, value?: unknown) => Promise<unknown>) =>
      mock.handlers.set(channel, fn)
  },
  BrowserWindow: {
    fromWebContents: mock.fromWebContents,
    getAllWindows: () => [
      { isDestroyed: () => false, webContents: { id: 1, send: mock.send } },
      { isDestroyed: () => false, webContents: { id: 2, send: mock.otherSend } }
    ]
  },
  app: { once: vi.fn() },
  dialog: { showOpenDialog: vi.fn() },
  shell: { openPath: vi.fn() }
}))

function fixture() {
  const service = {
    inspect: vi.fn(),
    send: vi.fn(),
    connect: vi.fn(),
    approve: vi.fn(),
    subscribe: vi.fn().mockReturnValue(vi.fn()),
    releaseOwner: vi.fn()
  }
  registerCodingAgentsIpc(service as unknown as CodingAgentService)
  const frame = {},
    destroyed = vi.fn()
  const event = { sender: { id: 1, mainFrame: frame, once: destroyed }, senderFrame: frame }
  const invoke = (channel: string, input?: unknown, source: unknown = event) =>
    mock.handlers.get(channel)!(source, input)
  return { service, invoke, destroyed }
}
beforeEach(() => {
  vi.clearAllMocks()
  mock.handlers.clear()
  mock.fromWebContents.mockReturnValue({})
})

describe('统一编程 IPC 安全边界', () => {
  it('拒绝外部窗口、子 frame、无效运行时、空任务和超长原始输入', async () => {
    const f = fixture()
    await expect(
      f.invoke(IPC.codingAgentInspect, 'codex', { sender: { mainFrame: {} }, senderFrame: {} })
    ).rejects.toThrow('无权')
    mock.fromWebContents.mockReturnValueOnce(null)
    await expect(f.invoke(IPC.codingAgentInspect, 'codex')).rejects.toThrow('无权')
    await expect(f.invoke(IPC.codingAgentInspect, 'other')).rejects.toThrow('Agent 无效')
    for (const content of [' ', ' '.repeat(50_001)])
      await expect(
        f.invoke(IPC.codingAgentSend, { runtimeId: 'codex', sessionId: 'ref', content })
      ).rejects.toThrow('编程任务')
    await expect(
      f.invoke(IPC.codingAgentApprove, {
        runtimeId: 'codex',
        sessionId: 'ref',
        approvalId: 'approval',
        approved: 1
      })
    ).rejects.toThrow('审批结果')
    expect(f.service.send).not.toHaveBeenCalled()
    expect(f.service.approve).not.toHaveBeenCalled()
  })
  it('合法请求只转发固定字段，系统错误只返回本地提示', async () => {
    const f = fixture()
    await f.invoke(IPC.codingAgentSend, {
      runtimeId: 'codex',
      sessionId: 'ref',
      content: ' 任务 ',
      arbitraryRpc: 'unsafe'
    })
    expect(f.service.send).toHaveBeenCalledWith('codex', 1, 'ref', '任务')
    f.service.connect.mockRejectedValueOnce(new Error('fixture-private-secret'))
    await expect(
      f.invoke(IPC.codingAgentConnect, { runtimeId: 'codex', directory: '/project' })
    ).rejects.toThrow('Agent 操作失败')
  })
  it('事件只交给连接所有者；窗口销毁释放连接', async () => {
    const f = fixture()
    await f.invoke(IPC.codingAgentInspect, 'codex')
    const listener = f.service.subscribe.mock.calls[0][0] as (owner: number, event: unknown) => void
    listener(1, { kind: 'runtime' })
    expect(mock.send).toHaveBeenCalledWith(WINDOW_EVENT.codingAgent, { kind: 'runtime' })
    expect(mock.otherSend).not.toHaveBeenCalled()
    const cleanup = f.destroyed.mock.calls[0][1] as () => void
    cleanup()
    expect(f.service.releaseOwner).toHaveBeenCalledWith(1)
  })
})
