import { create } from 'zustand'

import {
  AI_AGENT_ARENA_SOURCES,
  AI_AGENT_ARENA_TTL_MS
} from '../../../shared/ai-agent-arena'
import type { AiAgentArenaResult } from '@shared/ai-agent-arena'

interface AiAgentArenaState {
  result: AiAgentArenaResult | null
  loading: boolean
  refreshing: boolean
  error: string
  load(): Promise<void>
  refresh(force?: boolean): Promise<void>
  refreshIfStale(): Promise<void>
  clearError(): void
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : 'Agent 排行数据读取失败，请稍后重试'
}

function sourceIsStale(result: AiAgentArenaResult): boolean {
  const now = Date.now()
  return AI_AGENT_ARENA_SOURCES.some((source) => {
    const state = result.snapshot.sources[source.id]
    if (!state?.checkedAt) return true
    const checkedAt = Date.parse(state.checkedAt)
    return !Number.isFinite(checkedAt) || now - checkedAt >= AI_AGENT_ARENA_TTL_MS[source.id]
  })
}

/** Agent 榜只在这里保存快照；筛选、分页和详情由页面本地状态管理。 */
export const useAiAgentArenaStore = create<AiAgentArenaState>((set, get) => ({
  result: null,
  loading: false,
  refreshing: false,
  error: '',

  async load() {
    if (get().loading || get().refreshing) return
    const bridge = window.toolbox?.aiAgentArena
    if (!bridge) {
      set({ error: 'Agent 排行接口未就绪，请使用最新桌面应用' })
      return
    }
    set({ loading: get().result == null, error: '' })
    try {
      const cached = await bridge.get({ allowStale: true })
      set({ result: cached, loading: false })
      if (cached.stale || sourceIsStale(cached)) await get().refresh(false)
    } catch (error) {
      set({ loading: false, error: errorMessage(error) })
    }
  },

  async refresh(force = false) {
    if (get().refreshing) return
    const bridge = window.toolbox?.aiAgentArena
    if (!bridge) {
      set({ error: 'Agent 排行接口未就绪，请使用最新桌面应用' })
      return
    }
    set({ refreshing: true, error: '' })
    try {
      const result = await bridge.get(force ? { force: true } : {})
      set({ result, refreshing: false })
    } catch (error) {
      set({ refreshing: false, error: errorMessage(error) })
    }
  },

  async refreshIfStale() {
    const result = get().result
    if (!result || get().loading || get().refreshing) return
    if (result.stale || sourceIsStale(result)) await get().refresh(false)
  },

  clearError() {
    set({ error: '' })
  }
}))
