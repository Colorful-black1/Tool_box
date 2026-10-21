/** 桌面外观独立于 ReadConfig，不改变阅读器与手机端的纸张配色。 */
export const APP_THEMES = ['starry', 'graphite', 'paper', 'system'] as const
export type AppTheme = (typeof APP_THEMES)[number]
export type ResolvedAppTheme = Exclude<AppTheme, 'system'>

/** 保存在现有 kv 配置的 appearance 字段，无需数据库迁移。 */
export interface AppAppearance {
  theme: AppTheme
  backgroundMotion: boolean
}

export const DEFAULT_APP_APPEARANCE: Readonly<AppAppearance> = {
  theme: 'starry',
  backgroundMotion: true
}

/** 旧配置、损坏缓存或未来版本的枚举值均按字段回落，避免启动失败。 */
export function readAppAppearance(value: unknown): AppAppearance {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ...DEFAULT_APP_APPEARANCE }
  }
  const raw = value as Record<string, unknown>
  return {
    theme: APP_THEMES.includes(raw.theme as AppTheme)
      ? (raw.theme as AppTheme)
      : DEFAULT_APP_APPEARANCE.theme,
    backgroundMotion:
      typeof raw.backgroundMotion === 'boolean'
        ? raw.backgroundMotion
        : DEFAULT_APP_APPEARANCE.backgroundMotion
  }
}

export function resolveAppTheme(theme: AppTheme, dark: boolean): ResolvedAppTheme {
  return theme === 'system' ? (dark ? 'graphite' : 'paper') : theme
}
