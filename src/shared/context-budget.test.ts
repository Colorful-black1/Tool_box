import { describe, expect, it } from 'vitest'

import {
  DEFAULT_CONTEXT_WINDOW_TOKENS,
  hasShrunkEnough,
  isValidContextWindow,
  resolveContextBudget
} from './context-budget'

describe('resolveContextBudget', () => {
  it('128k 窗口按 80% 与输出/余量取较小值', () => {
    const budget = resolveContextBudget({ windowTokens: 128_000, fixedTokens: 0 })
    expect(budget.thresholdTokens).toBe(102_400)
    expect(budget.keepTokens).toBe(15_000)
    expect(budget.summaryMaxTokens).toBe(2_000)
  })

  it('32k 窗口触发更早，保留尾部降到下限', () => {
    const budget = resolveContextBudget({ windowTokens: 32_000, fixedTokens: 0 })
    expect(budget.thresholdTokens).toBe(20_800)
    expect(budget.keepTokens).toBe(4_000)
  })

  it('8k 小窗口的输出预留与余量按比例缩小', () => {
    const budget = resolveContextBudget({ windowTokens: 8_000, fixedTokens: 0 })
    expect(budget.outputReserveTokens).toBe(2_000)
    expect(budget.headroomTokens).toBe(800)
    expect(budget.thresholdTokens).toBe(5_200)
    expect(budget.keepTokens).toBe(3_200)
  })

  it('固定开销很大时保留预算至少留 1000', () => {
    const budget = resolveContextBudget({ windowTokens: 128_000, fixedTokens: 120_000 })
    expect(budget.keepTokens).toBe(1_000)
  })

  it('非法窗口回落到默认值', () => {
    expect(resolveContextBudget({ windowTokens: Number.NaN, fixedTokens: 0 }).windowTokens).toBe(
      DEFAULT_CONTEXT_WINDOW_TOKENS
    )
    expect(resolveContextBudget({ windowTokens: 1, fixedTokens: 0 }).windowTokens).toBe(4_000)
  })
})

describe('isValidContextWindow', () => {
  it('只接受 4k 到 10M 的整数', () => {
    expect(isValidContextWindow(128_000)).toBe(true)
    expect(isValidContextWindow(4_000)).toBe(true)
    expect(isValidContextWindow(10_000_000)).toBe(true)
    expect(isValidContextWindow(3_999)).toBe(false)
    expect(isValidContextWindow(10_000_001)).toBe(false)
    expect(isValidContextWindow(128_000.5)).toBe(false)
    expect(isValidContextWindow('128000')).toBe(false)
    expect(isValidContextWindow(null)).toBe(false)
  })
})

describe('hasShrunkEnough', () => {
  it('至少释放 1000 token 且不小于 5%', () => {
    expect(hasShrunkEnough(10_000, 8_000)).toBe(true)
    expect(hasShrunkEnough(10_000, 9_600)).toBe(false)
    expect(hasShrunkEnough(100_000, 94_000)).toBe(true)
    expect(hasShrunkEnough(100_000, 96_000)).toBe(false)
  })

  it('空摘要不算收缩', () => {
    expect(hasShrunkEnough(10_000, 0)).toBe(false)
  })
})
