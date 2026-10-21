import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DEFAULT_APP_APPEARANCE } from '../../../shared/appearance'
import { useAppearanceStore } from './appearance-store'

describe('外观偏好的读取与保存', () => {
  const get = vi.fn()
  const save = vi.fn()
  const setItem = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    get.mockResolvedValue(null)
    save.mockResolvedValue(null)
    vi.stubGlobal('window', {
      toolbox: { config: { get, set: save } },
      localStorage: { setItem }
    })
    useAppearanceStore.setState({
      appearance: { ...DEFAULT_APP_APPEARANCE },
      loaded: false,
      loading: false,
      saving: false,
      error: ''
    })
  })

  afterEach(() => vi.unstubAllGlobals())

  it('旧配置使用默认外观，不写回或覆盖阅读配置', async () => {
    get.mockResolvedValue({ themeIndex: 4, fontSize: 24 })
    await useAppearanceStore.getState().load()
    expect(useAppearanceStore.getState().appearance).toEqual(DEFAULT_APP_APPEARANCE)
    expect(save).not.toHaveBeenCalled()
    expect(useAppearanceStore.getState().loaded).toBe(true)
  })

  it('读取保存的偏好并更新首屏缓存', async () => {
    const appearance = { theme: 'system', backgroundMotion: false }
    get.mockResolvedValue({ appearance })
    await useAppearanceStore.getState().load()
    expect(useAppearanceStore.getState().appearance).toEqual(appearance)
    expect(setItem).toHaveBeenCalledWith('toolbox-appearance-v1', JSON.stringify(appearance))
  })

  it('重复选择当前外观不写配置', async () => {
    await useAppearanceStore.getState().load()
    await useAppearanceStore.getState().patch(DEFAULT_APP_APPEARANCE)
    expect(save).not.toHaveBeenCalled()
  })

  it('读取失败时禁止覆盖未知的持久化偏好，允许重试', async () => {
    get.mockRejectedValueOnce(new Error('合成读取失败'))
    await useAppearanceStore.getState().load()
    await useAppearanceStore.getState().patch({ theme: 'paper' })
    expect(save).not.toHaveBeenCalled()
    expect(useAppearanceStore.getState().error).toContain('读取失败')
    await useAppearanceStore.getState().load()
    expect(useAppearanceStore.getState().loaded).toBe(true)
    expect(useAppearanceStore.getState().error).toBe('')
  })

  it('保存时只发送外观字段，成功后缓存新值', async () => {
    await useAppearanceStore.getState().load()
    await useAppearanceStore.getState().patch({ theme: 'paper' })
    const appearance = { theme: 'paper', backgroundMotion: true }
    expect(save).toHaveBeenCalledWith({ appearance })
    expect(setItem).toHaveBeenLastCalledWith('toolbox-appearance-v1', JSON.stringify(appearance))
  })

  it('保存失败恢复上次外观，不缓存未保存的选择', async () => {
    await useAppearanceStore.getState().load()
    setItem.mockClear()
    save.mockRejectedValueOnce(new Error('合成保存失败'))
    await useAppearanceStore.getState().patch({ theme: 'paper' })
    expect(useAppearanceStore.getState().appearance).toEqual(DEFAULT_APP_APPEARANCE)
    expect(useAppearanceStore.getState().error).toContain('已恢复上次外观')
    expect(setItem).not.toHaveBeenCalled()
    expect(useAppearanceStore.getState().saving).toBe(false)
  })

  it('保存尚未完成时禁止并发覆盖', async () => {
    await useAppearanceStore.getState().load()
    let finish: () => void = () => undefined
    save.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        })
    )
    const saving = useAppearanceStore.getState().patch({ theme: 'paper' })
    expect(useAppearanceStore.getState().saving).toBe(true)
    await useAppearanceStore.getState().patch({ theme: 'graphite' })
    expect(save).toHaveBeenCalledTimes(1)
    finish()
    await saving
    expect(useAppearanceStore.getState().appearance.theme).toBe('paper')
  })

  it('桥接不可用时显示降级提示', async () => {
    vi.stubGlobal('window', {})
    await useAppearanceStore.getState().load()
    expect(useAppearanceStore.getState().loaded).toBe(false)
    expect(useAppearanceStore.getState().error).toContain('桌面桥接尚未就绪')
  })
})
