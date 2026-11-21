import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC } from '../../shared/ipc-contract'
import { AiAgentArenaError } from '../services/ai-agent-arena/errors'
import { registerAiAgentArenaIpc } from './ai-agent-arena-ipc'

const mock = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, value?: unknown) => unknown>(),
  owner: vi.fn(),
  get: vi.fn()
}))
vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (event: unknown, value?: unknown) => unknown) =>
      mock.handlers.set(channel, handler)
  },
  BrowserWindow: { fromWebContents: mock.owner }
}))

beforeEach(() => {
  mock.handlers.clear()
  mock.owner.mockReturnValue({})
  mock.get.mockReset()
})

describe('Agent 排行 IPC', () => {
  it('只接受主窗口主 frame 并校验布尔查询', async () => {
    registerAiAgentArenaIpc({ get: mock.get } as never)
    const frame = {}
    const event = { sender: { mainFrame: frame }, senderFrame: frame }
    await mock.handlers.get(IPC.aiAgentArenaGet)!(event, {
      allowStale: true,
      force: false,
      extra: 'ignored'
    })
    expect(mock.get).toHaveBeenCalledWith({ allowStale: true, force: false })
    await expect(
      mock.handlers.get(IPC.aiAgentArenaGet)!(event, ['bad'])
    ).rejects.toThrow('查询参数')
    mock.owner.mockReturnValue(null)
    await expect(mock.handlers.get(IPC.aiAgentArenaGet)!(event, {})).rejects.toThrow('无权')
  })

  it('保留可读的抓取错误文案', async () => {
    mock.get.mockRejectedValue(new AiAgentArenaError('FrontierHarness 暂不可用'))
    registerAiAgentArenaIpc({ get: mock.get } as never)
    const frame = {}
    const event = { sender: { mainFrame: frame }, senderFrame: frame }
    await expect(mock.handlers.get(IPC.aiAgentArenaGet)!(event, {})).rejects.toThrow(
      'FrontierHarness 暂不可用'
    )
  })
})
