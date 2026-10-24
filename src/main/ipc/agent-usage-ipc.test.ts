import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC } from '../../shared/ipc-contract'
import { registerAgentUsageIpc } from './agent-usage-ipc'

const fake = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, value: unknown) => Promise<unknown>>(),
  owner: vi.fn(),
  query: vi.fn(),
  choose: vi.fn(),
  dialog: vi.fn()
}))
vi.mock('electron', () => ({
  app: { getPath: () => '/synthetic-user-data' },
  BrowserWindow: { fromWebContents: fake.owner },
  ipcMain: {
    handle: (channel: string, fn: (e: unknown, v: unknown) => Promise<unknown>) =>
      fake.handlers.set(channel, fn)
  },
  dialog: { showOpenDialog: fake.dialog }
}))
vi.mock('node:fs/promises', () => ({
  readFile: vi.fn().mockResolvedValue('{}'),
  writeFile: vi.fn(),
  rename: vi.fn()
}))
vi.mock('../services/agent-usage/usage-service', () => ({
  AgentUsageService: class {
    query = fake.query
    chooseSource = fake.choose
  }
}))
beforeEach(() => {
  vi.clearAllMocks()
  fake.owner.mockReturnValue({})
  fake.handlers.clear()
  registerAgentUsageIpc()
})
const frame = {}
const event = { sender: { mainFrame: frame }, senderFrame: frame }
const invoke = (channel: string, value: unknown, source: unknown = event) =>
  fake.handlers.get(channel)!(source, value)
describe('用量 IPC 安全边界', () => {
  it('拒绝外部窗口、子 frame 和无效筛选，均不扫描', async () => {
    await expect(
      invoke(IPC.agentUsageQuery, {}, { sender: { mainFrame: {} }, senderFrame: {} })
    ).rejects.toThrow('无权')
    fake.owner.mockReturnValueOnce(null)
    await expect(invoke(IPC.agentUsageQuery, {})).rejects.toThrow('无权')
    await expect(invoke(IPC.agentUsageQuery, { client: '__proto__' })).rejects.toThrow()
    expect(fake.query).not.toHaveBeenCalled()
  })
  it('忽略渲染层路径，只采用原生文件选择器结果，取消不更新设置', async () => {
    fake.dialog.mockResolvedValueOnce({ canceled: true, filePaths: [] })
    expect(await invoke(IPC.agentUsageChooseSource, 'zcode')).toBe(false)
    expect(fake.choose).not.toHaveBeenCalled()
    fake.dialog.mockResolvedValueOnce({ canceled: false, filePaths: ['/selected/usage.db'] })
    await invoke(IPC.agentUsageChooseSource, 'zcode')
    expect(fake.choose).toHaveBeenCalledWith('zcode', '/selected/usage.db')
    expect(fake.dialog.mock.calls[0][0].properties).toEqual(['openFile'])
  })
  it('系统异常不会暴露路径、原始 JSON 或 SQL', async () => {
    fake.query.mockRejectedValueOnce(new Error('PRIVATE_SENTINEL SELECT raw FROM secret'))
    await expect(invoke(IPC.agentUsageQuery, {})).rejects.toThrow('无法读取用量统计')
  })
})
