import { create } from 'zustand'

import { AI_WORLD_AA_TTL_MS } from '../../../shared/ai-world-aa'
import type { AiWorldAaKeyStatus, AiWorldAaResult } from '@shared/ai-world-aa'

interface AiWorldAaState {
  result: AiWorldAaResult | null
  keyStatus: AiWorldAaKeyStatus
  loading: boolean
  refreshing: boolean
  savingKey: boolean
  error: string
  load(): Promise<void>
  refresh(force?: boolean): Promise<void>
  refreshIfStale(): Promise<void>
  loadKeyStatus(): Promise<void>
  saveKey(apiKey: string): Promise<boolean>
  clearKey(): Promise<boolean>
  clearError(): void
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : 'Artificial Analysis 数据读取失败，请稍后重试'
}

function sourceIsStale(result: AiWorldAaResult): boolean {
  if (!result.state.checkedAt) return true
  const checkedAt = Date.parse(result.state.checkedAt)
  return !Number.isFinite(checkedAt) || Date.now() - checkedAt >= AI_WORLD_AA_TTL_MS
}

/** AA 榜独立保存快照与 Key 状态；不触碰模型榜的 ECI store。 */
export const useAiWorldAaStore = create<AiWorldAaState>((set, get) => ({
  result: null,
  keyStatus: { configured: false },
  loading: false,
  refreshing: false,
  savingKey: false,
  error: '',

  async load() {
    if (get().loading || get().refreshing) return
    const bridge = window.toolbox?.aiWorldAa
    if (!bridge) {
      set({ error: 'Artificial Analysis 接口未就绪，请使用最新桌面应用' })
      return
    }
    set({ loading: get().result == null, error: '' })
    try {
      const result = await bridge.get({ allowStale: true })
      set({
        result,
        loading: false,
        keyStatus: { configured: result.state.configured }
      })
      if (
        result.state.configured &&
        result.snapshot &&
        (result.stale || sourceIsStale(result))
      )
        await get().refresh(false)
    } catch (error) {
      set({ loading: false, error: errorMessage(error) })
    }
  },

  async refresh(force = false) {
    if (get().refreshing) return
    const bridge = window.toolbox?.aiWorldAa
    if (!bridge) {
      set({ error: 'Artificial Analysis 接口未就绪，请使用最新桌面应用' })
      return
    }
    set({ refreshing: true, error: '' })
    try {
      const result = await bridge.get(force ? { force: true } : {})
      set({
        result,
        refreshing: false,
        keyStatus: { configured: result.state.configured }
      })
    } catch (error) {
      set({ refreshing: false, error: errorMessage(error) })
    }
  },

  async refreshIfStale() {
    const result = get().result
    if (!result?.state.configured || get().loading || get().refreshing) return
    if (result.stale || sourceIsStale(result)) await get().refresh(false)
  },

  async loadKeyStatus() {
    const bridge = window.toolbox?.aiWorldAa
    if (!bridge) return
    try {
      const keyStatus = await bridge.keyStatus()
      set({ keyStatus })
    } catch {
      // 状态读取失败不覆盖榜单；配置按钮保持未配置并允许重试。
    }
  },

  async saveKey(apiKey: string) {
    const bridge = window.toolbox?.aiWorldAa
    if (!bridge) {
      set({ error: 'Artificial Analysis 接口未就绪，请使用最新桌面应用' })
      return false
    }
    set({ savingKey: true, error: '' })
    try {
      const keyStatus = await bridge.saveKey({ apiKey })
      set({ keyStatus, savingKey: false })
      await get().refresh(true)
      return true
    } catch (error) {
      set({ savingKey: false, error: errorMessage(error) })
      return false
    }
  },

  async clearKey() {
    const bridge = window.toolbox?.aiWorldAa
    if (!bridge) {
      set({ error: 'Artificial Analysis 接口未就绪，请使用最新桌面应用' })
      return false
    }
    try {
      const keyStatus = await bridge.clearKey()
      set({ keyStatus, result: null, error: '' })
      await get().load()
      return true
    } catch (error) {
      set({ error: errorMessage(error) })
      return false
    }
  },

  clearError() {
    set({ error: '' })
  }
}))
