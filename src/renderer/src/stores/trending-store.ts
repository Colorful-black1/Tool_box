import { create } from 'zustand'

import type {
  TrendingLanguage,
  TrendingPeriod,
  TrendingQuery,
  TrendingResult
} from '../../../shared/github-trending'
import { loadTrendingPrefs } from '../lib/trending-prefs'
import type { TrendingRefreshInterval } from '../lib/trending-prefs'

interface TrendingState {
  period: TrendingPeriod
  language: TrendingLanguage | ''
  refreshInterval: TrendingRefreshInterval
  result: TrendingResult | null
  loading: boolean
  refreshing: boolean
  error: string

  load(force?: boolean): Promise<void>
  refresh(): Promise<void>
  setPeriod(period: TrendingPeriod): void
  setLanguage(language: TrendingLanguage | ''): void
  setRefreshInterval(interval: TrendingRefreshInterval): void
  openRepo(fullName: string): Promise<void>
}

const initial = loadTrendingPrefs()
let generation = 0

/** 页面级状态：不把榜单塞进全局 app-store，切走页面即释放。 */
export const useTrendingStore = create<TrendingState>((set, get) => ({
  period: initial.period,
  language: initial.language,
  refreshInterval: initial.refreshInterval,
  result: null,
  loading: false,
  refreshing: false,
  error: '',

  load: async (force = false): Promise<void> => {
    const ticket = ++generation
    const { period, language } = get()
    const query: TrendingQuery = {
      period,
      ...(language ? { language } : {})
    }
    const bridge = window.toolbox?.trending
    if (!bridge) {
      set({
        loading: false,
        refreshing: false,
        error: '当前版本未提供开源热榜，请更新并重启应用'
      })
      return
    }

    set({
      error: '',
      loading: !get().result,
      refreshing: true
    })

    try {
      if (!force) {
        // 先按毫秒级读取缓存；命中且新鲜就不再联网。
        const cached = await bridge.list({ ...query, allowStale: true })
        if (ticket !== generation) return
        if (cached) set({ result: cached, loading: false })
        if (cached && !cached.stale) return
      }

      const fresh = await bridge.list({ ...query, force: true })
      if (ticket !== generation) return
      set({ result: fresh ?? null, loading: false, error: '' })
    } catch (error) {
      if (ticket !== generation) return
      set({ loading: false, error: normaliseError(error) })
    } finally {
      if (ticket === generation) set({ loading: false, refreshing: false })
    }
  },

  refresh: async (): Promise<void> => {
    await get().load(true)
  },

  setPeriod: (period): void => {
    if (period === get().period) return
    generation++
    set({ period, result: null, error: '', loading: true, refreshing: false })
  },

  setLanguage: (language): void => {
    if (language === get().language) return
    generation++
    set({ language, result: null, error: '', loading: true, refreshing: false })
  },

  setRefreshInterval: (refreshInterval): void => {
    set({ refreshInterval })
  },

  openRepo: async (fullName): Promise<void> => {
    const bridge = window.toolbox?.trending
    if (!bridge) return
    try {
      await bridge.open(fullName)
    } catch (error) {
      set({ error: normaliseError(error) })
    }
  }
}))

/** Electron 会把 IPC 异常包成 "Error invoking remote method ..."；只保留业务文案。 */
function normaliseError(error: unknown): string {
  const raw = error instanceof Error ? error.message : ''
  const cleaned = raw.replace(/^Error invoking remote method '[^']+':\s*/, '').trim()
  return cleaned || '读取 GitHub 热榜失败，请稍后重试'
}
