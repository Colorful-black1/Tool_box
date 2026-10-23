import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC } from '../../shared/ipc-contract'
import { registerDeveloperDiagnosticsIpc } from './developer-diagnostics-ipc'

const mock = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, ...args: unknown[]) => unknown>(),
  owner: vi.fn(),
  inspect: vi.fn(() => []),
  ports: vi.fn(async () => ({ entries: [] }))
}))
vi.mock('electron', () => ({
  BrowserWindow: { fromWebContents: mock.owner },
  ipcMain: {
    handle: (channel: string, handler: (event: unknown, ...args: unknown[]) => unknown) =>
      mock.handlers.set(channel, handler)
  }
}))
vi.mock('../services/developer-diagnostics', () => ({
  inspectCertificates: mock.inspect,
  listPortProcesses: mock.ports
}))

beforeEach(() => {
  vi.clearAllMocks()
  mock.handlers.clear()
  mock.owner.mockReturnValue({})
  registerDeveloperDiagnosticsIpc()
})

describe('开发诊断 IPC 边界', () => {
  it('拒绝非主窗口、非主 frame；外部输入不进入系统服务', () => {
    const sender = { mainFrame: {} }
    const event = { sender, senderFrame: sender.mainFrame }
    mock.owner.mockReturnValue(null)
    for (const handler of mock.handlers.values())
      expect(() => handler(event, 'text')).toThrow('无权')
    mock.owner.mockReturnValue({})
    for (const handler of mock.handlers.values())
      expect(() => handler({ sender, senderFrame: {} }, 'text')).toThrow('无权')
    expect(mock.inspect).not.toHaveBeenCalled()
    expect(mock.ports).not.toHaveBeenCalled()
  })
  it('证书严格校验大小与类型，端口接口不接受命令参数', async () => {
    const sender = { mainFrame: {} }
    const event = { sender, senderFrame: sender.mainFrame }
    const inspect = mock.handlers.get(IPC.toolsCertificateInspect)!
    expect(() => inspect(event, {})).toThrow()
    expect(() => inspect(event, ' '.repeat(131073))).toThrow()
    expect(mock.inspect).not.toHaveBeenCalled()
    inspect(event, '  public-certificate  ')
    expect(mock.inspect).toHaveBeenCalledWith('public-certificate')
    await mock.handlers.get(IPC.systemNetworkPorts)!(event, 'ignored command')
    expect(mock.ports).toHaveBeenCalledWith()
  })
})
