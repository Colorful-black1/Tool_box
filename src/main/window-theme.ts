import { nativeTheme } from 'electron'
import type { BrowserWindow } from 'electron'

import { TITLE_BAR_HEIGHT, resolveAppTheme, titleBarPalette } from '../shared/appearance'
import type { AppAppearance } from '../shared/appearance'

/** 只包含主题相关的窗口构造参数，避免调用方关心平台差异。 */
export interface WindowThemeOptions {
  backgroundColor: string
  titleBarStyle?: 'hidden'
  titleBarOverlay?: {
    color: string
    symbolColor: string
    height: number
  }
}

function paletteFor(appearance: AppAppearance): { color: string; symbolColor: string } {
  const resolved = resolveAppTheme(appearance.theme, nativeTheme.shouldUseDarkColors)
  return titleBarPalette(resolved)
}

/**
 * Windows 下隐藏系统标题栏并保留原生最小化 / 最大化 / 关闭按钮覆盖层，
 * 让标题栏颜色跟着应用主题走。其它平台维持系统标题栏，避免破坏原生手势。
 */
export function windowThemeOptions(appearance: AppAppearance): WindowThemeOptions {
  const palette = paletteFor(appearance)
  if (process.platform !== 'win32') return { backgroundColor: palette.color }

  return {
    backgroundColor: palette.color,
    titleBarStyle: 'hidden',
    titleBarOverlay: { ...palette, height: TITLE_BAR_HEIGHT }
  }
}

/** 主题切换时同步窗口底色与原生控件覆盖层；窗口销毁后调用为空操作。 */
export function applyWindowTheme(win: BrowserWindow, appearance: AppAppearance): void {
  if (win.isDestroyed()) return
  const palette = paletteFor(appearance)
  win.setBackgroundColor(palette.color)
  if (process.platform === 'win32') {
    win.setTitleBarOverlay({ ...palette, height: TITLE_BAR_HEIGHT })
  }
}
