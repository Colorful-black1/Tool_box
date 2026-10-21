import { beforeEach, describe, expect, it, vi } from 'vitest'

import { DEFAULT_SHORTCUT_CONFIG } from '../shared/types'
import { ShortcutManager } from './shortcuts'

const shortcuts = vi.hoisted(() => ({
  register: vi.fn(),
  unregister: vi.fn(),
  unregisterAll: vi.fn()
}))
vi.mock('electron', () => ({ globalShortcut: shortcuts }))

const OLD = 'Control+Shift+Space'
const NEXT = 'Control+Shift+K'

describe('全局快捷键状态与配置一致', () => {
  let saved: Record<string, unknown>
  let active: Map<string, () => void>
  let occupied: Set<string>
  const store = { configGet: vi.fn(), configSet: vi.fn() }
  const trigger = vi.fn()

  beforeEach(() => {
    vi.resetAllMocks()
    saved = { shortcut: { enabled: true, accelerator: OLD } }
    active = new Map()
    occupied = new Set()
    store.configGet.mockImplementation(() => structuredClone(saved))
    store.configSet.mockImplementation((patch: Record<string, unknown>) => {
      saved = { ...saved, ...patch }
      return saved
    })
    shortcuts.register.mockImplementation((key: string, callback: () => void) => {
      if (occupied.has(key) || active.has(key)) return false
      active.set(key, callback)
      return true
    })
    shortcuts.unregister.mockImplementation((key: string) => active.delete(key))
    shortcuts.unregisterAll.mockImplementation(() => active.clear())
  })

  it('没有保存配置时默认关闭', () => {
    saved = {}
    const manager = new ShortcutManager(store, trigger)
    manager.init()
    expect(manager.read()).toEqual(DEFAULT_SHORTCUT_CONFIG)
    expect(active.size).toBe(0)
  })

  it('启动时注册保存的组合并可触发唤起', () => {
    const manager = new ShortcutManager(store, trigger)
    manager.init()
    active.get(OLD)?.()
    expect(trigger).toHaveBeenCalledOnce()
    expect(manager.read()).toEqual({ enabled: true, accelerator: OLD })
  })

  it.each(['占用', '抛错'])('新组合%s时原组合仍可用，且不落盘', (failure) => {
    const manager = new ShortcutManager(store, trigger)
    manager.init()
    if (failure === '占用') occupied.add(NEXT)
    else
      shortcuts.register.mockImplementationOnce(() => {
        throw new Error('native failure')
      })
    const result = manager.set({ enabled: true, accelerator: NEXT })
    expect(result.ok).toBe(false)
    expect(result.config).toEqual({ enabled: true, accelerator: OLD })
    expect([...active.keys()]).toEqual([OLD])
    expect(store.configSet).not.toHaveBeenCalled()
  })

  it('重复应用当前组合不重新注册', () => {
    const manager = new ShortcutManager(store, trigger)
    manager.init()
    expect(manager.set({ enabled: true, accelerator: OLD }).ok).toBe(true)
    expect(shortcuts.register).toHaveBeenCalledTimes(1)
  })

  it('新组合注册成功后更新配置并释放旧组合', () => {
    const manager = new ShortcutManager(store, trigger)
    manager.init()
    const result = manager.set({ enabled: true, accelerator: NEXT })
    expect(result).toEqual({ ok: true, config: { enabled: true, accelerator: NEXT } })
    expect([...active.keys()]).toEqual([NEXT])
    expect(saved.shortcut).toEqual(result.config)
  })

  it.each([true, false])('保存 enabled=%s 失败时保留原注册及配置', (enabled) => {
    const manager = new ShortcutManager(store, trigger)
    manager.init()
    store.configSet.mockImplementationOnce(() => {
      throw new Error('disk failure')
    })
    const result = manager.set({ enabled, accelerator: NEXT })
    expect(result.ok).toBe(false)
    expect(result.error).not.toContain('disk failure')
    expect(result.config).toEqual({ enabled: true, accelerator: OLD })
    expect([...active.keys()]).toEqual([OLD])
  })

  it('关闭时释放组合并保存关闭状态', () => {
    const manager = new ShortcutManager(store, trigger)
    manager.init()
    expect(manager.set({ enabled: false, accelerator: NEXT }).config.enabled).toBe(false)
    expect(active.size).toBe(0)
    expect(saved.shortcut).toEqual({ enabled: false, accelerator: NEXT })
  })

  it('启动时组合被占用不显示已启用，保存偏好以便下次重试', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      occupied.add(OLD)
      const manager = new ShortcutManager(store, trigger)
      manager.init()
      expect(manager.read()).toEqual({ enabled: false, accelerator: OLD })
      expect(store.configSet).not.toHaveBeenCalled()
      occupied.delete(OLD)
      expect(manager.set({ enabled: true, accelerator: OLD }).ok).toBe(true)
      expect(active.has(OLD)).toBe(true)
      expect(warn).toHaveBeenCalled()
    } finally {
      warn.mockRestore()
    }
  })

  it('拒绝非预设组合且不干扰当前注册', () => {
    const manager = new ShortcutManager(store, trigger)
    manager.init()
    expect(manager.set({ enabled: true, accelerator: 'invalid' }).ok).toBe(false)
    expect([...active.keys()]).toEqual([OLD])
    expect(store.configSet).not.toHaveBeenCalled()
  })

  it('退出时清理所有注册', () => {
    const manager = new ShortcutManager(store, trigger)
    manager.init()
    manager.dispose()
    expect(active.size).toBe(0)
    expect(shortcuts.unregisterAll).toHaveBeenCalledOnce()
  })
})
