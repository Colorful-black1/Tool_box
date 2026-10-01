import { DEFAULT_READ_CONFIG } from '../../../shared/types'
import type { ReadConfig } from '../../../shared/types'
import { create } from 'zustand'

interface ConfigState {
  config: ReadConfig
  loaded: boolean
  load(): Promise<void>
  patch(partial: Partial<ReadConfig>): Promise<void>
  reset(): void
}

/** 从持久化的 kv 配置合并默认值，保证缺失字段回落到旧项目默认 */
function mergeConfig(raw: Record<string, unknown> | null): ReadConfig {
  if (!raw) return DEFAULT_READ_CONFIG
  return {
    fontSize: numberOr(raw.fontSize, DEFAULT_READ_CONFIG.fontSize),
    lineSpacing: numberOr(raw.lineSpacing, DEFAULT_READ_CONFIG.lineSpacing),
    fontFamily: stringOr(raw.fontFamily, DEFAULT_READ_CONFIG.fontFamily),
    themeIndex: numberOr(raw.themeIndex, DEFAULT_READ_CONFIG.themeIndex),
    nightMode: boolOr(raw.nightMode, DEFAULT_READ_CONFIG.nightMode),
    pageMode: enumOr(raw.pageMode, ['scroll', 'horizontal', 'cover'], DEFAULT_READ_CONFIG.pageMode),
    brightnessMask: numberOr(raw.brightnessMask, DEFAULT_READ_CONFIG.brightnessMask),
    disguiseTarget: enumOr(
      raw.disguiseTarget,
      ['none', 'excel', 'word'],
      DEFAULT_READ_CONFIG.disguiseTarget
    ),
    blurOnFocusLost: boolOr(raw.blurOnFocusLost, DEFAULT_READ_CONFIG.blurOnFocusLost),
    bossHotkey: stringOr(raw.bossHotkey, DEFAULT_READ_CONFIG.bossHotkey),
    pinned: boolOr(raw.pinned, DEFAULT_READ_CONFIG.pinned),
    appBgPreset: numberOr(raw.appBgPreset, DEFAULT_READ_CONFIG.appBgPreset),
    appBgImage: stringOr(raw.appBgImage, DEFAULT_READ_CONFIG.appBgImage),
    bookshelfSort: enumOr(
      raw.bookshelfSort,
      ['manual', 'recentRead', 'addedTime', 'title'],
      DEFAULT_READ_CONFIG.bookshelfSort
    ),
    lockEnabled: boolOr(raw.lockEnabled, DEFAULT_READ_CONFIG.lockEnabled),
    relockDelayMs: numberOr(raw.relockDelayMs, DEFAULT_READ_CONFIG.relockDelayMs)
  }
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback
}

function boolOr(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function enumOr<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T
): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback
}

export const useConfigStore = create<ConfigState>((set, get) => ({
  config: DEFAULT_READ_CONFIG,
  loaded: false,

  load: async () => {
    if (!window.toolbox) {
      set({ config: DEFAULT_READ_CONFIG, loaded: true })
      return
    }
    const raw = await window.toolbox.config.get()
    set({ config: mergeConfig(raw), loaded: true })
  },

  patch: async (partial) => {
    const next = { ...get().config, ...partial }
    set({ config: next })
    if (!window.toolbox) return
    await window.toolbox.config.set(partial as Record<string, unknown>)
  },

  reset: () => set({ config: DEFAULT_READ_CONFIG })
}))