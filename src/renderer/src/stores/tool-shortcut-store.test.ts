import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useToolShortcutStore } from './tool-shortcut-store'

const config = { get: vi.fn(), set: vi.fn() }
beforeEach(() => {
  vi.resetAllMocks()
  vi.stubGlobal('window', { toolbox: { config } })
  config.get.mockResolvedValue({ toolFavorites: ['json'], toolRecent: ['uuid'], fontSize: 23 })
  config.set.mockResolvedValue({})
  useToolShortcutStore.setState({
    favorites: [],
    recent: [],
    loaded: false,
    loading: false,
    saving: false,
    error: ''
  })
})
afterEach(() => vi.unstubAllGlobals())

describe('快捷偏好写入协调', () => {
  it('收藏与最近仅发送各自字段，不覆盖排序及阅读设置', async () => {
    const store = useToolShortcutStore.getState()
    await store.load()
    await store.toggleFavorite('diff', ['json', 'diff', 'uuid'])
    await store.recordOpened('diff')
    expect(config.set.mock.calls.map(([patch]) => patch)).toEqual([
      { toolFavorites: ['json', 'diff'] },
      { toolRecent: ['diff', 'uuid'] }
    ])
  })
  it('连续收藏、打开与取消收藏串行，不丢失后续操作', async () => {
    let finish!: () => void
    config.set.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = () => resolve({})
        })
    )
    await useToolShortcutStore.getState().load()
    const first = useToolShortcutStore.getState().toggleFavorite('diff', ['json', 'diff'])
    await vi.waitFor(() => expect(config.set).toHaveBeenCalledTimes(1))
    const next = useToolShortcutStore.getState().recordOpened('diff')
    const last = useToolShortcutStore.getState().toggleFavorite('json', ['json', 'diff'])
    expect(config.set).toHaveBeenCalledTimes(1)
    finish()
    await Promise.all([first, next, last])
    expect(useToolShortcutStore.getState().favorites).toEqual(['diff'])
    expect(useToolShortcutStore.getState().recent).toEqual(['diff', 'uuid'])
  })
  it('收藏失败回退且不泄露系统错误，重新点击可重试', async () => {
    await useToolShortcutStore.getState().load()
    config.set.mockRejectedValueOnce(new Error('private-detail'))
    await useToolShortcutStore.getState().toggleFavorite('diff', ['json', 'diff'])
    expect(useToolShortcutStore.getState().favorites).toEqual(['json'])
    expect(useToolShortcutStore.getState().error).toContain('已恢复')
    expect(useToolShortcutStore.getState().error).not.toContain('private')
    await useToolShortcutStore.getState().toggleFavorite('diff', ['json', 'diff'])
    expect(useToolShortcutStore.getState().favorites).toEqual(['json', 'diff'])
  })
  it('最近保存失败保留内存，重复打开也会重试保存，成功后不重复写', async () => {
    await useToolShortcutStore.getState().load()
    config.set.mockRejectedValueOnce(new Error('failure'))
    await useToolShortcutStore.getState().recordOpened('diff')
    expect(useToolShortcutStore.getState().recent[0]).toBe('diff')
    await useToolShortcutStore.getState().recordOpened('diff')
    expect(config.set).toHaveBeenCalledTimes(2)
    await useToolShortcutStore.getState().recordOpened('diff')
    expect(config.set).toHaveBeenCalledTimes(2)
  })
  it('读取迟到时先合并旧配置，再记录本次打开；读取失败不覆盖旧偏好', async () => {
    let finish!: (value: unknown) => void
    config.get.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    const loading = useToolShortcutStore.getState().load()
    const opened = useToolShortcutStore.getState().recordOpened('diff')
    expect(config.set).not.toHaveBeenCalled()
    finish({ toolFavorites: ['json'], toolRecent: ['uuid'] })
    await Promise.all([loading, opened])
    expect(useToolShortcutStore.getState().recent).toEqual(['diff', 'uuid'])
    useToolShortcutStore.setState({ loaded: false })
    config.get.mockRejectedValueOnce(new Error('failure'))
    config.set.mockClear()
    await useToolShortcutStore.getState().recordOpened('json')
    expect(config.set).not.toHaveBeenCalled()
  })
  it('无桥接仍可使用工具，旧空配置可恢复；收藏时清理已移除 ID', async () => {
    vi.stubGlobal('window', {})
    await useToolShortcutStore.getState().load()
    expect(useToolShortcutStore.getState().error).toContain('桥接尚未就绪')
    vi.stubGlobal('window', { toolbox: { config } })
    config.get.mockResolvedValueOnce({ toolFavorites: ['removed'] })
    await useToolShortcutStore.getState().toggleFavorite('json', ['json'])
    expect(useToolShortcutStore.getState().favorites).toEqual(['json'])
  })
})
