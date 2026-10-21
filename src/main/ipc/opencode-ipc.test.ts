import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC, WINDOW_EVENT } from '../../shared/ipc-contract'
import type { OpenCodeService } from '../services/opencode/opencode-service'
import { registerOpenCodeIpc } from './opencode-ipc'

const mocked = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, value?: unknown) => Promise<unknown>>(),
  send: vi.fn(),
  fromWebContents: vi.fn(),
  quit: vi.fn()
}))
vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (event: unknown, value?: unknown) => Promise<unknown>) =>
      mocked.handlers.set(channel, handler)
  },
  BrowserWindow: {
    fromWebContents: mocked.fromWebContents,
    getAllWindows: () => [{ isDestroyed: () => false, webContents: { send: mocked.send } }]
  },
  app: { once: mocked.quit },
  dialog: { showOpenDialog: vi.fn() },
  shell: { openPath: vi.fn() }
}))

function setup() {
  const service = {
    inspect: vi.fn().mockResolvedValue({ connected: false }),
    connect: vi.fn(),
    send: vi.fn(),
    approve: vi.fn(),
    subscribe: vi.fn().mockReturnValue(vi.fn()),
    disconnect: vi.fn()
  }
  registerOpenCodeIpc(service as unknown as OpenCodeService)
  const frame = {}
  const event = { sender: { mainFrame: frame }, senderFrame: frame }
  const invoke = (channel: string, value?: unknown, context: unknown = event) =>
    mocked.handlers.get(channel)!(context, value)
  return { service, invoke }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocked.handlers.clear()
  mocked.fromWebContents.mockReturnValue({})
})

describe('OpenCode IPC 边界', () => {
  it('子 frame 与非应用窗口不能调用进程能力', async () => {
    const { service, invoke } = setup()
    await expect(
      invoke(IPC.opencodeInspect, undefined, { sender: { mainFrame: {} }, senderFrame: {} })
    ).rejects.toThrow('无权')
    mocked.fromWebContents.mockReturnValue(null)
    await expect(invoke(IPC.opencodeInspect)).rejects.toThrow('无权')
    expect(service.inspect).not.toHaveBeenCalled()
  })
  it('任务与审批参数校验失败时不会进入服务', async () => {
    const { service, invoke } = setup()
    await expect(invoke(IPC.opencodeSend, { sessionId: 's1', content: ' ' })).rejects.toThrow(
      '操作失败'
    )
    await expect(
      invoke(IPC.opencodeApprove, { sessionId: 's1', approvalId: 'a1', approved: 1 })
    ).rejects.toThrow('操作失败')
    expect(service.send).not.toHaveBeenCalled()
    expect(service.approve).not.toHaveBeenCalled()
  })
  it('系统错误只返回固定提示，合法请求按契约转发', async () => {
    const { service, invoke } = setup()
    service.connect.mockRejectedValue(new Error('fixture-private-system-detail'))
    await expect(invoke(IPC.opencodeConnect, '/fixture/project')).rejects.toThrow('操作失败')
    await invoke(IPC.opencodeSend, { sessionId: 's1', content: ' 测试任务 ' })
    expect(service.send).toHaveBeenCalledWith('s1', '测试任务')
  })
  it('会话事件集中经窗口事件通道广播', () => {
    const { service } = setup()
    const listener = service.subscribe.mock.calls[0][0] as (event: unknown) => void
    listener({ kind: 'connection', connected: true })
    expect(mocked.send).toHaveBeenCalledWith(WINDOW_EVENT.opencode, {
      kind: 'connection',
      connected: true
    })
  })
})
