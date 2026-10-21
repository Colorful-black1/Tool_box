/**
 * 设计令牌：与桌面端 `src/renderer/src/styles/global.css` 的 `:root` 变量一一对应。
 * 桌面端继续用 CSS 变量，本文件是同一套色板在 React Native 侧的等价物，
 * 两边改色需同步，否则会出现「桌面改了手机没改」的漂移。
 */

export const colors = {
  /** 深空底色，同时用作 Android adaptiveIcon 背景 */
  bgDeep: '#080b16',
  /** 玻璃面板底色 */
  bgPanel: 'rgba(20, 26, 48, 0.72)',
  bgPanelSolid: '#141A30',
  /** 金色主色：主按钮、选中态、强调文字 */
  gold: '#e8c98a',
  goldDim: '#b89b62',
  goldLine: 'rgba(232, 201, 138, 0.35)',
  /** 青色点缀 */
  cyan: '#7fe7ff',
  /** 危险操作（删除） */
  pink: '#ff9ec7',
  textHi: '#f4eedd',
  textMid: '#a9b0c8',
  textDim: '#8791ad',
  /** 输入框 / 卡片描边 */
  line: 'rgba(232, 201, 138, 0.22)',
  lineSoft: 'rgba(255, 255, 255, 0.045)',
  /** 状态条 */
  success: '#7fe7a0',
  danger: '#ff9ec7'
} as const

/**
 * 字体族。RN 不支持 CSS font stack，只能给单族名，按平台回退：
 * iOS 走 PingFang SC，Android 走 Noto Sans SC / 思源黑体。
 */
export const fonts = {
  serif: 'serif',
  sans: 'sans-serif',
  mono: 'monospace'
} as const

/** 间距刻度（与桌面端 8pt 栅格一致） */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 17,
  xl: 22,
  xxl: 30
} as const

export const radius = {
  sm: 6,
  md: 10,
  lg: 14,
  pill: 999
} as const

/** 主题字体族映射：RN 的 fontFamily 只能单值，这里按语义暴露 */
export function fontFor(kind: keyof typeof fonts): string {
  return fonts[kind]
}
