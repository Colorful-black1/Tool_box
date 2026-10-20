import { describe, expect, it } from 'vitest'

import type { ReadingStat } from './types'
import { buildStatsRange, isDateKey, resolveStatsRange, shiftDate, todayKey } from './reading-stats'

describe('todayKey', () => {
  it('输出本地时区的 YYYY-MM-DD', () => {
    expect(todayKey()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

describe('isDateKey', () => {
  it('只接受 YYYY-MM-DD 形状', () => {
    expect(isDateKey('2026-10-20')).toBe(true)
    expect(isDateKey('2026/10/20')).toBe(false)
    expect(isDateKey('2026-1-2')).toBe(false)
  })
})

describe('shiftDate', () => {
  it('往前与往后平移', () => {
    expect(shiftDate('2026-10-20', -1)).toBe('2026-10-19')
    expect(shiftDate('2026-10-20', 1)).toBe('2026-10-21')
  })

  it('跨月与跨年都正确', () => {
    expect(shiftDate('2026-03-01', -1)).toBe('2026-02-28')
    expect(shiftDate('2026-01-01', -1)).toBe('2025-12-31')
  })
})

describe('resolveStatsRange', () => {
  const today = '2026-10-20'

  it('days 表示最近 N 天（含今天）', () => {
    expect(resolveStatsRange({ days: 7 }, today)).toEqual({
      fromDate: '2026-10-14',
      toDate: '2026-10-20'
    })
  })

  it('days 为 1 时只含今天', () => {
    expect(resolveStatsRange({ days: 1 }, today)).toEqual({
      fromDate: '2026-10-20',
      toDate: '2026-10-20'
    })
  })

  it('to 留空表示今天', () => {
    expect(resolveStatsRange({ from: '2026-01-01' }, today)).toEqual({
      fromDate: '2026-01-01',
      toDate: today
    })
  })

  it('绝对区间原样返回', () => {
    expect(resolveStatsRange({ from: '2026-01-01', to: '2026-01-31' }, today)).toEqual({
      fromDate: '2026-01-01',
      toDate: '2026-01-31'
    })
  })

  it('格式不对、倒置区间与越界天数都报错', () => {
    expect(() => resolveStatsRange({ from: '昨天' }, today)).toThrow(/起始日期格式/)
    expect(() => resolveStatsRange({ from: '2026-01-01', to: '20260101' }, today)).toThrow(
      /结束日期格式/
    )
    expect(() => resolveStatsRange({ from: '2026-02-01', to: '2026-01-01' }, today)).toThrow(
      /不能晚于/
    )
    expect(() => resolveStatsRange({ days: 0 }, today)).toThrow(/天数/)
    expect(() => resolveStatsRange({ days: 400 }, today)).toThrow(/天数/)
  })
})

describe('buildStatsRange', () => {
  const rows: ReadingStat[] = [
    { date: '2026-10-19', durationMs: 60_000, charCount: 500 },
    { date: '2026-10-20', durationMs: 30_000, charCount: 200 }
  ]

  it('汇总时长、字数与有记录的天数', () => {
    const range = buildStatsRange(rows, '2026-10-19', '2026-10-20')
    expect(range.totalDurationMs).toBe(90_000)
    expect(range.totalCharCount).toBe(700)
    expect(range.activeDays).toBe(2)
    expect(range.daily).toHaveLength(2)
  })

  it('空区间返回全零', () => {
    const range = buildStatsRange([], '2026-10-19', '2026-10-20')
    expect(range.totalDurationMs).toBe(0)
    expect(range.activeDays).toBe(0)
  })
})
