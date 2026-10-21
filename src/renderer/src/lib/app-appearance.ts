import { readAppAppearance, resolveAppTheme } from '../../../shared/appearance'
import type { AppAppearance } from '../../../shared/appearance'

const CACHE_KEY = 'toolbox-appearance-v1'

/** 仅缓存非敏感的外观偏好，首屏同步应用；kv 配置仍是持久化真相源。 */
export function readAppearanceCache(): AppAppearance {
  try {
    return readAppAppearance(JSON.parse(window.localStorage.getItem(CACHE_KEY) ?? 'null'))
  } catch {
    // 存储被禁用或缓存损坏时使用默认主题，不阻止启动。
    return readAppAppearance(null)
  }
}

export function cacheAppearance(appearance: AppAppearance): void {
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(appearance))
  } catch {
    // 缓存只用于减少首屏闪烁；写入失败不影响主进程配置保存。
  }
}

export function applyAppAppearance(appearance: AppAppearance, dark: boolean): void {
  document.documentElement.dataset.theme = resolveAppTheme(appearance.theme, dark)
  document.documentElement.dataset.backgroundMotion = String(appearance.backgroundMotion)
}
