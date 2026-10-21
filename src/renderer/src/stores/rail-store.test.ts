import { beforeEach, describe, expect, it } from 'vitest'

import { RAIL_NARROW_BREAKPOINT, useRailStore } from './rail-store'

describe('rail-store', () => {
  beforeEach(() => {
    useRailStore.setState({ collapsed: false, narrow: false })
  })

  it('默认是展开的', () => {
    expect(useRailStore.getState().collapsed).toBe(false)
    expect(useRailStore.getState().narrow).toBe(false)
  })

  it('手动切换折叠', () => {
    useRailStore.getState().toggle()
    expect(useRailStore.getState().collapsed).toBe(true)
    useRailStore.getState().toggle()
    expect(useRailStore.getState().collapsed).toBe(false)
  })

  it('窗口窄于断点时强制折叠', () => {
    useRailStore.getState().syncWidth(RAIL_NARROW_BREAKPOINT - 1)
    expect(useRailStore.getState().narrow).toBe(true)
  })

  it('窗口够宽时不强制折叠', () => {
    useRailStore.getState().syncWidth(RAIL_NARROW_BREAKPOINT)
    expect(useRailStore.getState().narrow).toBe(false)
  })

  // 关键：窄窗只是「临时」折叠，窗口变宽后要恢复用户手动的那份偏好
  it('窗口变宽后恢复用户手动折叠的状态', () => {
    useRailStore.getState().toggle()
    expect(useRailStore.getState().collapsed).toBe(true)

    useRailStore.getState().syncWidth(800)
    expect(useRailStore.getState().narrow).toBe(true)
    expect(useRailStore.getState().collapsed).toBe(true)

    useRailStore.getState().syncWidth(1600)
    expect(useRailStore.getState().narrow).toBe(false)
    // 手动折叠过的偏好还在 → 仍然是折叠态
    expect(useRailStore.getState().collapsed).toBe(true)
  })

  it('宽度没变化时不产生多余的状态更新', () => {
    const before = useRailStore.getState()
    useRailStore.getState().syncWidth(1400)
    useRailStore.getState().syncWidth(1400)
    expect(useRailStore.getState().narrow).toBe(before.narrow)
  })
})
