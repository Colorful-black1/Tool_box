import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC, WINDOW_EVENT } from '../../shared/ipc-contract'
import { dialog } from 'electron'
import type { CodingAgentService } from '../services/coding-agents/coding-agent-service'
import { registerCodingAgentsIpc } from './coding-agents-ipc'

const mock = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, value?: unknown) => Promise<unknown>>(),
  fromWebContents: vi.fn(),
  send: vi.fn(),
  otherSend: vi.fn(),
  windowDestroyed: vi.fn(() => false),
  contentsDestroyed: vi.fn(() => false),
  onQuit: vi.fn()
}))
vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (event: unknown, value?: unknown) => Promise<unknown>) =>
      mock.handlers.set(channel, fn)
  },
  BrowserWindow: {
    fromWebContents: mock.fromWebContents,
    getAllWindows: () => [
      {
        isDestroyed: mock.windowDestroyed,
        webContents: { id: 1, isDestroyed: mock.contentsDestroyed, send: mock.send }
      },
      {
        isDestroyed: () => false,
        webContents: { id: 2, isDestroyed: () => false, send: mock.otherSend }
      }
    ]
  },
  app: { once: mock.onQuit },
  dialog: { showOpenDialog: vi.fn() },
  shell: { openPath: vi.fn() }
}))

function fixture() {
  const disposeEvents = vi.fn()
  const service = {
    inspect: vi.fn(),
    send: vi.fn(),
    connect: vi.fn(),
    selectProject: vi.fn(async (_id: string, _owner: number, directory: string) => directory),
    allowDirectory: vi.fn(),
    approve: vi.fn(),
    answerQuestion: vi.fn(),
    subscribe: vi.fn().mockReturnValue(disposeEvents),
    dispose: vi.fn(),
    releaseOwner: vi.fn()
  }
  registerCodingAgentsIpc(service as unknown as CodingAgentService)
  const frame = {},
    destroyed = vi.fn()
  const event = { sender: { id: 1, mainFrame: frame, once: destroyed }, senderFrame: frame }
  const invoke = (channel: string, input?: unknown, source: unknown = event) =>
    mock.handlers.get(channel)!(source, input)
  return { service, invoke, destroyed, disposeEvents }
}
beforeEach(() => {
  vi.clearAllMocks()
  mock.handlers.clear()
  mock.fromWebContents.mockReturnValue({})
  mock.windowDestroyed.mockReturnValue(false)
  mock.contentsDestroyed.mockReturnValue(false)
})

describe('统一编程 IPC 安全边界', () => {
  it('问答答复逐项校验并绑定发送窗口，不允许任意响应对象', async () => {
    const f = fixture()
    const input = {
      runtimeId: 'codex',
      sessionId: 'local-session',
      requestId: 'question-ref',
      cancelled: false,
      answers: [{ questionId: 'q0', values: ['选项一'] }]
    }
    await f.invoke(IPC.codingAgentQuestion, input)
    expect(f.service.answerQuestion).toHaveBeenCalledWith(
      'codex',
      1,
      'local-session',
      expect.objectContaining({ answers: input.answers })
    )
    for (const patch of [
      { cancelled: 'false' },
      { answers: Array(5).fill(input.answers[0]) },
      { answers: [{ questionId: 'q0', values: ['x'.repeat(4001)] }] },
      { answers: [{ questionId: 'q0', values: [''] }] },
      { requestId: '' },
      { runtimeId: 'other' }
    ])
      await expect(f.invoke(IPC.codingAgentQuestion, { ...input, ...patch })).rejects.toThrow()
    expect(f.service.answerQuestion).toHaveBeenCalledOnce()
  })
  it('目录选择按显式 Agent 保存，取消不保存，旧无参调用仍只授权目录', async () => {
    const f = fixture()
    vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({
      canceled: false,
      filePaths: ['C:/project']
    })
    expect(await f.invoke(IPC.codingAgentDirectory, 'claude-desktop')).toBe('C:/project')
    expect(f.service.selectProject).toHaveBeenCalledExactlyOnceWith(
      'claude-desktop',
      1,
      'C:/project'
    )
    vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({ canceled: true, filePaths: [] })
    expect(await f.invoke(IPC.codingAgentDirectory, 'codex')).toBeNull()
    expect(f.service.selectProject).toHaveBeenCalledTimes(1)
    vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({
      canceled: false,
      filePaths: ['C:/legacy']
    })
    expect(await f.invoke(IPC.codingAgentDirectory)).toBe('C:/legacy')
    expect(f.service.allowDirectory).toHaveBeenCalledExactlyOnceWith(1, 'C:/legacy')
    expect(f.service.connect).not.toHaveBeenCalled()
  })

  it('项目保存参数在主进程校验，不认识的 Agent 不打开目录选择器', async () => {
    const f = fixture()
    await expect(f.invoke(IPC.codingAgentDirectory, 'unknown')).rejects.toThrow()
    expect(dialog.showOpenDialog).not.toHaveBeenCalled()
    await expect(
      f.invoke(IPC.codingAgentProject, { runtimeId: 'codex', directory: '' })
    ).rejects.toThrow()
    expect(f.service.selectProject).not.toHaveBeenCalled()
    await f.invoke(IPC.codingAgentProject, { runtimeId: 'codex', directory: 'C:/project' })
    expect(f.service.selectProject).toHaveBeenCalledExactlyOnceWith('codex', 1, 'C:/project')
  })
  it('窗口仍存在但 WebContents 已销毁时丢弃退出终态，不调用 send', () => {
    const f = fixture()
    const listener = f.service.subscribe.mock.calls[0][0] as (owner: number, event: unknown) => void
    mock.contentsDestroyed.mockReturnValue(true)
    mock.send.mockImplementationOnce(() => {
      throw new TypeError('Object has been destroyed')
    })
    expect(() => listener(1, { kind: 'runtime' })).not.toThrow()
    expect(mock.send).not.toHaveBeenCalled()
    expect(mock.otherSend).not.toHaveBeenCalled()
    mock.send.mockReset()
    mock.contentsDestroyed.mockReturnValue(false)
    mock.windowDestroyed.mockReturnValue(true)
    expect(() => listener(1, { kind: 'runtime' })).not.toThrow()
    expect(mock.send).not.toHaveBeenCalled()
  })
  it('will-quit 在断开 Agent 前解除事件订阅', () => {
    const f = fixture()
    const quit = mock.onQuit.mock.calls.find(([name]) => name === 'will-quit')![1] as () => void
    quit()
    expect(f.disposeEvents).toHaveBeenCalledOnce()
    expect(f.service.dispose).toHaveBeenCalledOnce()
    expect(f.disposeEvents.mock.invocationCallOrder[0]).toBeLessThan(
      f.service.dispose.mock.invocationCallOrder[0]
    )
  })
  it('Desktop 作为独立运行时复用既有校验通道，不接受任意 profile 或路由参数', async () => {
    const f = fixture()
    await f.invoke(IPC.codingAgentConnect, {
      runtimeId: 'claude-desktop',
      directory: '/fixture/project',
      profile: '../private',
      token: 'fixture-ignored-token'
    })
    expect(f.service.connect).toHaveBeenCalledWith('claude-desktop', 1, '/fixture/project')
    await f.invoke(IPC.codingAgentSend, {
      runtimeId: 'claude-desktop',
      sessionId: 'desktop-ref',
      content: '合成任务'
    })
    expect(f.service.send).toHaveBeenCalledWith('claude-desktop', 1, 'desktop-ref', '合成任务')
  })
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
