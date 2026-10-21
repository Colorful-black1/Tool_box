/**
 * 左侧导航栏的展开 / 折叠状态。
 *
 * 两种来源，合并成一个有效状态：
 * - `collapsed`：**用户手动**折叠与否（点 chevron 按钮切换）；
 * - `narrow`：窗口太窄时的**强制折叠**（只显示图标）。
 *
 * 窗口变宽后 `narrow` 解除，**恢复用户手动的那份偏好** —— 不会来回跳。
 */
import { create } from 'zustand'

/**
 * 窄窗断点：窗口宽度小于这个值就只显示图标。
 *
 * 取 1120px：再窄的话，对话页的会话栏（250px）+ 展开的导航栏（168px）
 * 会把正文挤得没法看。
 */
export const RAIL_NARROW_BREAKPOINT = 1120

interface RailState {
  /** 用户手动折叠 */
  collapsed: boolean
  /** 窗口太窄，强制折叠 */
  narrow: boolean
  /** 手动切换折叠 */
  toggle(): void
  /** 窗口宽度变化时同步窄窗状态 */
  syncWidth(width: number): void
}

export const useRailStore = create<RailState>((set, get) => ({
  collapsed: false,
  narrow: false,
  toggle: () => set({ collapsed: !get().collapsed }),
  syncWidth: (width: number) => {
    const narrow = width < RAIL_NARROW_BREAKPOINT
    if (narrow !== get().narrow) set({ narrow })
  }
}))
