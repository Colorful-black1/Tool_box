import { describe, expect, it } from 'vitest'
import { loadUsagePrefs, periodRange, rollingRange, saveUsagePrefs } from './usage-prefs'

describe('统计页周期与偏好', () => {
  const now = new Date(2026, 9, 24, 12, 0)
  it('今日 / 近 7 天 / 本月 / 近 30 天使用本地日历边界', () => {
    expect(periodRange('today', now)).toEqual({ from: '2026-10-24', to: '2026-10-24' })
    expect(periodRange('week', now)).toEqual({ from: '2026-10-18', to: '2026-10-24' })
    expect(periodRange('month', now)).toEqual({ from: '2026-10-01', to: '2026-10-24' })
    expect(periodRange('days30', now)).toEqual({ from: '2026-09-25', to: '2026-10-24' })
  })
  it('跨月与跨年不会算错起始日', () => {
    const january = new Date(2027, 0, 3)
    expect(periodRange('week', january)).toEqual({ from: '2026-12-28', to: '2027-01-03' })
    expect(periodRange('month', january)).toEqual({ from: '2027-01-01', to: '2027-01-03' })
  })
  it('趋势图与「近 N 天」共用自然日边界', () => {
    expect(rollingRange(7, now)).toEqual({ from: '2026-10-18', to: '2026-10-24' })
    expect(rollingRange(30, now)).toEqual({ from: '2026-09-25', to: '2026-10-24' })
    expect(rollingRange(90, now)).toEqual({ from: '2026-07-27', to: '2026-10-24' })
  })
  it('累计与自定义不设日期；没有本地存储时安全降级', () => {
    expect(periodRange('all', now)).toEqual({})
    expect(periodRange('custom', now)).toEqual({})
    expect(loadUsagePrefs()).toBeNull()
    expect(() => saveUsagePrefs({ period: 'today' })).not.toThrow()
  })
})
