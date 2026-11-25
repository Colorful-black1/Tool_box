import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC } from '../../shared/ipc-contract'
import { registerAiWorldAaIpc } from './ai-world-aa-ipc'

const mock = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, value?: unknown) => unknown>(),
  owner: vi.fn(),
  get: vi.fn(),
  status: vi.fn(),
  save: vi.fn(),
  clear: vi.fn()
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (event: unknown, value?: unknown) => unknown) =>
      mock.handlers.set(channel, handler)
  },
  BrowserWindow: { fromWebContents: mock.owner }
}))

function event(): { sender: { mainFrame: object }; senderFrame: object } {
  const frame = {}
  return { sender: { mainFrame: frame }, senderFrame: frame }
}

beforeEach(() => {
  mock.handlers.clear()
  mock.owner.mockReturnValue({})
  mock.get.mockReset()
  mock.status.mockReset().mockReturnValue({ configured: true })
  mock.save.mockReset().mockReturnValue({ configured: true })
  mock.clear.mockReset().mockReturnValue({ configured: false })
})

function register(): void {
  registerAiWorldAaIpc(
    { get: mock.get } as never,
    {
      status: mock.status,
      saveKey: mock.save,
      clearKey: mock.clear
    } as never
  )
}

describe('Artificial Analysis IPC', () => {
  it('只接受主窗口主 frame 并校验查询参数', async () => {
    register()
    const handler = mock.handlers.get(IPC.aiWorldAaGet)!
    await handler(event(), { allowStale: true, force: false, extra: 'ignored' })
    expect(mock.get).toHaveBeenCalledWith({ allowStale: true, force: false })

    await expect(handler(event(), ['bad'])).rejects.toThrow('查询参数')
    mock.owner.mockReturnValue(null)
    await expect(handler(event(), {})).rejects.toThrow('无权')
  })

  it('Key 只透传裁剪后的字符串，状态查询不返回明文', async () => {
    register()
    const save = mock.handlers.get(IPC.aiWorldAaKeySave)!
    save(event(), { apiKey: '  test-key-12345678  ' })
    expect(mock.save).toHaveBeenCalledWith('test-key-12345678')
    expect(() => save(event(), { apiKey: '   ' })).toThrow('不能为空')

    const status = mock.handlers.get(IPC.aiWorldAaKeyStatus)!
    expect(status(event())).toEqual({ configured: true })
    expect(mock.handlers.get(IPC.aiWorldAaKeyClear)!(event())).toEqual({
      configured: false
    })
    expect(mock.clear).toHaveBeenCalledTimes(1)
  })
})
