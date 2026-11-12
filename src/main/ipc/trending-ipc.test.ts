import { beforeEach, describe, expect, it, vi } from 'vitest'

import { IPC } from '../../shared/ipc-contract'
import type { GithubTrendingService } from '../services/github-trending/service'
import { registerTrendingIpc } from './trending-ipc'

const mocked = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, value?: unknown) => Promise<unknown>>(),
  openExternal: vi.fn()
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (event: unknown, value?: unknown) => Promise<unknown>) =>
      mocked.handlers.set(channel, handler)
  },
  shell: { openExternal: mocked.openExternal }
}))

function setup() {
  const service = {
    list: vi.fn().mockResolvedValue({
      period: 'daily',
      language: null,
      source: 'trending',
      items: [],
      fetchedAtMs: 1,
      stale: false,
      warning: null
    })
  }
  registerTrendingIpc(service as unknown as GithubTrendingService)
  const invoke = (channel: string, value?: unknown) => mocked.handlers.get(channel)!({}, value)
  return { service, invoke }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocked.handlers.clear()
})

describe('GitHub 热榜 IPC', () => {
  it('校验后调用服务，异常只透出业务文案', async () => {
    const { service, invoke } = setup()
    await expect(invoke(IPC.trendingList, { period: 'daily' })).resolves.toMatchObject({
      source: 'trending'
    })
    expect(service.list).toHaveBeenCalledWith({ period: 'daily' })

    await expect(invoke(IPC.trendingList, { period: 'nope' })).rejects.toThrow('周期')
    expect(service.list).toHaveBeenCalledTimes(1)
  })

  it('打开仓库只拼固定 GitHub 地址', async () => {
    const { invoke } = setup()
    await invoke(IPC.trendingOpen, 'meta/astryx')
    expect(mocked.openExternal).toHaveBeenCalledWith('https://github.com/meta/astryx')

    await expect(invoke(IPC.trendingOpen, 'https://evil.example/x')).rejects.toThrow('仓库名无效')
    expect(mocked.openExternal).toHaveBeenCalledTimes(1)
  })
})
