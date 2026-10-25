import { describe, expect, it } from 'vitest'
import { calendarDays, localDateValue, validCalendarValue } from './calendar'

describe('日期控件的墙上日期校验', () => {
  it.each(['2024-02-29', '2026-01-31', '2026-12-31'])('接受有效日期 %s', (value) => {
    expect(validCalendarValue(value)).toBe(true)
  })
  it.each(['2026-02-29', '2026-02-30', '2026-13-01', '2026-1-01', '0099-01-01', '2026-01-01Z'])(
    '拒绝溢出和不完整日期 %s',
    (value) => {
      expect(validCalendarValue(value)).toBe(false)
    }
  )
  it('分钟和秒精度分别校验，接受显示空格与接口 T 分隔符', () => {
    expect(validCalendarValue('2026-10-25 23:59', true)).toBe(true)
    expect(validCalendarValue('2026-10-25T23:59:59', true, true)).toBe(true)
    expect(validCalendarValue('2026-10-25T24:00', true)).toBe(false)
    expect(validCalendarValue('2026-10-25T23:59:60', true, true)).toBe(false)
    expect(validCalendarValue('2026-10-25T23:59', true, true)).toBe(false)
  })
  it('以星期一开始，跨年填充固定六周，包含闰日', () => {
    const days = calendarDays(2024, 1)
    expect(days).toHaveLength(42)
    expect(days[0].value).toBe('2024-01-29')
    expect(days.find((day) => day.value === '2024-02-29')?.current).toBe(true)
    expect(calendarDays(2026, 0)[0].value).toBe('2025-12-29')
  })
  it('本机日期不通过 UTC 截断生成', () => {
    expect(localDateValue(new Date(2026, 9, 25, 0, 1))).toBe('2026-10-25')
  })
})
