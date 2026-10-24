import { describe, expect, it } from 'vitest'
import type { UsageSessionView } from './agent-usage'
import {
  cacheHitRate,
  csvCell,
  formatCompact,
  formatCost,
  formatPercent,
  formatTokens,
  usageCsv
} from './usage-format'

describe('用量展示格式', () => {
  it('精确值与紧凑值都保留未知语义', () => {
    expect(formatTokens(null)).toBe('未知')
    expect(formatTokens(1234)).toBe('1,234')
    expect(formatCompact(null)).toBe('未知')
    expect(formatCompact(9999)).toBe('9,999')
    expect(formatCompact(10_000)).toBe('1 万')
    expect(formatCompact(12_345)).toBe('1.2 万')
    expect(formatCompact(123_456_789)).toBe('1.23 亿')
  })
  it('花费与命中率不把缺失当成零', () => {
    expect(formatCost(null)).toBe('未上报')
    expect(formatCost(0)).toBe('0.00 USD')
    expect(formatCost(0.001)).toBe('<0.01 USD')
    const tokens = {
      input: 20,
      output: 0,
      cacheRead: 80,
      cacheWrite: 0,
      reasoning: 0,
      total: 100
    }
    expect(cacheHitRate(tokens)).toBe(0.8)
    expect(cacheHitRate({ ...tokens, cacheRead: null })).toBeNull()
    expect(formatPercent(null)).toBe('未知')
    expect(formatPercent(0.8123)).toBe('81.2%')
  })
  it('CSV 按 RFC 4180 转义并包含表头', () => {
    expect(csvCell('plain')).toBe('plain')
    expect(csvCell('a,b')).toBe('"a,b"')
    expect(csvCell('a"b')).toBe('"a""b"')
    expect(csvCell(null)).toBe('')
    const row: UsageSessionView = {
      client: 'opencode',
      sessionId: 's,1',
      project: 'C:\\project',
      model: 'fixture',
      time: 0,
      tokens: {
        input: 1,
        output: 2,
        cacheRead: 3,
        cacheWrite: 4,
        reasoning: 5,
        total: 15
      },
      requests: 1,
      costUsd: 0.5,
      costPartial: false,
      partial: false
    }
    const csv = usageCsv([row])
    const lines = csv.split('\r\n')
    expect(lines).toHaveLength(2)
    expect(lines[0]).toContain('总 Token')
    expect(lines[1]).toContain('"s,1"')
    expect(lines[1]).toContain('OpenCode')
    expect(lines[1]).toContain('0.5')
  })
})
