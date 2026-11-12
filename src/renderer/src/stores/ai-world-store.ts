import { create } from 'zustand'

import { AI_WORLD_CACHE_TTL_MS } from '@shared/ai-model-world'
import type { AiWorldResult } from '@shared/ai-model-world'

interface AiWorldState {
  result: AiWorldResult | null
  loading: boolean
  refreshing: boolean
  error: string
  load(): Promise<void>
  refresh(): Promise<void>
  refreshIfStale(): Promise<void>
  openSource(url: string): Promise<void>
  clearError(): void
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'AI 模型数据读取失败，请稍后重试'
}

/** AI 模型世界页面只在这里保存快照；筛选、分页和详情都由页面本地状态管理。 */
export const useAiWorldStore = create<AiWorldState>((set, get) => ({
  result: null,
  loading: false,
  refreshing: false,
  error: '',

  async load() {
    if (get().loading || get().refreshing) return
    const bridge = window.toolbox?.aiWorld
    if (!bridge) {
      set({ error: 'AI 模型接口未就绪，请使用最新桌面应用' })
      return
    }
    set({ loading: get().result == null, error: '' })
    try {
      const cached = await bridge.get({ allowStale: true })
      set({ result: cached, loading: false })
      // 缓存过期时后台再拉一次最新快照。
      if (cached.stale) await get().refresh()
    } catch (error) {
      set({ loading: false, error: errorMessage(error) })
    }
  },

  async refresh() {
    if (get().refreshing) return
    const bridge = window.toolbox?.aiWorld
    if (!bridge) {
      set({ error: 'AI 模型接口未就绪，请使用最新桌面应用' })
      return
    }
    set({ refreshing: true, error: '' })
    try {
      const result = await bridge.get({ force: true })
      set({ result, refreshing: false })
    } catch (error) {
      set({ refreshing: false, error: errorMessage(error) })
    }
  },

  async refreshIfStale() {
    const result = get().result
    if (!result || get().loading || get().refreshing) return
    if (Date.now() - result.fetchedAtMs > AI_WORLD_CACHE_TTL_MS) await get().refresh()
  },

  async openSource(url) {
    const bridge = window.toolbox?.aiWorld
    if (!bridge) {
      set({ error: 'AI 模型接口未就绪，请使用最新桌面应用' })
      return
    }
    try {
      await bridge.openSource(url)
    } catch (error) {
      set({ error: errorMessage(error) })
    }
  },

  clearError() {
    set({ error: '' })
  }
}))
