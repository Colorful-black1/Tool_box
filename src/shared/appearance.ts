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

/** Windows 自绘标题栏高度（DIP）；与 global.css 的 --titlebar-height 保持一致。 */
export const TITLE_BAR_HEIGHT = 32

export interface TitleBarPalette {
  /** 标题栏 / 窗口控件覆盖层底色，对应各主题的 --bg-deep。 */
  color: string
  /** 最小化、最大化、关闭按钮的线条颜色。 */
  symbolColor: string
}

const TITLE_BAR_PALETTES: Record<ResolvedAppTheme, TitleBarPalette> = {
  starry: { color: '#080b16', symbolColor: '#e8c98a' },
  graphite: { color: '#171a1f', symbolColor: '#d5bf97' },
  paper: { color: '#f3f0e8', symbolColor: '#282a31' }
}

/**
 * 原生窗口控件不读取 CSS 变量，只能由主进程单独配色。
 * 底色与三套主题的 --bg-deep 对齐，线条色取主题强调色。
 */
export function titleBarPalette(theme: ResolvedAppTheme): TitleBarPalette {
  return TITLE_BAR_PALETTES[theme]
}
