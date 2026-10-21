import { create } from 'zustand'

import { readAppAppearance } from '../../../shared/appearance'
import type { AppAppearance } from '../../../shared/appearance'
import { cacheAppearance, readAppearanceCache } from '../lib/app-appearance'

/** 外观单独订阅与保存，不修改阅读配置、AI 草稿或其他配置项。 */
interface AppearanceState {
  appearance: AppAppearance
  loaded: boolean
  loading: boolean
  saving: boolean
  error: string
  load(): Promise<void>
  patch(partial: Partial<AppAppearance>): Promise<void>
}

export const useAppearanceStore = create<AppearanceState>((set, get) => ({
  appearance: readAppearanceCache(),
  loaded: false,
  loading: false,
  saving: false,
  error: '',

  load: async () => {
    if (get().loading || get().loaded) return
    if (!window.toolbox) {
      set({ error: '桌面桥接尚未就绪，暂时无法读取外观设置。' })
      return
    }
    set({ loading: true, error: '' })
    try {
      const raw = await window.toolbox.config.get()
      const appearance = readAppAppearance(raw?.appearance)
      cacheAppearance(appearance)
      set({ appearance, loaded: true })
    } catch {
      set({ error: '外观设置读取失败，已保留当前外观。请重试。' })
    } finally {
      set({ loading: false })
    }
  },

  patch: async (partial) => {
    if (!get().loaded || get().saving) return
    if (!window.toolbox) {
      set({ error: '桌面桥接尚未就绪，暂时无法保存外观设置。' })
      return
    }
    const previous = get().appearance
    const appearance = { ...previous, ...partial }
    if (
      appearance.theme === previous.theme &&
      appearance.backgroundMotion === previous.backgroundMotion
    )
      return
    set({ appearance, saving: true, error: '' })
    try {
      await window.toolbox.config.set({ appearance })
      cacheAppearance(appearance)
    } catch {
      set({ appearance: previous, error: '外观设置保存失败，已恢复上次外观。请重试。' })
    } finally {
      set({ saving: false })
    }
  }
}))
