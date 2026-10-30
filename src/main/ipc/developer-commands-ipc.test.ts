import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC } from '../../shared/ipc-contract'
import type { ToolboxStore } from '../services/chat-store/chat-store'
import { registerDeveloperCommandsIpc } from './developer-commands-ipc'

const mock = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, value?: unknown) => unknown>(),
  owner: vi.fn()
}))
vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, action: (event: unknown, value?: unknown) => unknown) =>
      mock.handlers.set(channel, action)
  },
  BrowserWindow: { fromWebContents: mock.owner }
}))
beforeEach(() => {
  mock.handlers.clear()
  mock.owner.mockReturnValue({})
})
describe('命令库 IPC 边界', () => {
  it('非受管窗口和子 frame 不能读取或写入', () => {
    const store = { commandLibraryGet: vi.fn(), commandLibrarySet: vi.fn() }
    registerDeveloperCommandsIpc(store as unknown as ToolboxStore)
    const frame = {}
    const event = { sender: { mainFrame: frame }, senderFrame: {} }
    expect(() => mock.handlers.get(IPC.developerCommandsRead)!(event)).toThrow('无权')
    mock.owner.mockReturnValue(null)
    expect(() =>
      mock.handlers.get(IPC.developerCommandsSave)!({ ...event, senderFrame: frame }, {})
    ).toThrow('无权')
    expect(store.commandLibraryGet).not.toHaveBeenCalled()
    expect(store.commandLibrarySet).not.toHaveBeenCalled()
  })
  it('非法正文或布尔值在进入数据服务前被拒绝', () => {
    const store = { commandLibraryGet: vi.fn(), commandLibrarySet: vi.fn() }
    registerDeveloperCommandsIpc(store as unknown as ToolboxStore)
    const frame = {}
    const event = { sender: { mainFrame: frame }, senderFrame: frame }
    expect(() =>
      mock.handlers.get(IPC.developerCommandsSave)!(event, { command: ['bad'] })
    ).toThrow()
    expect(() =>
      mock.handlers.get(IPC.developerCommandsFavorite)!(event, {
        id: 'builtin:docker-logs',
        value: 1,
        expectedRevision: 0
      })
    ).toThrow()
    expect(store.commandLibraryGet).not.toHaveBeenCalled()
  })
})
