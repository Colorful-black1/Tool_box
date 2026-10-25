import { describe, expect, it } from 'vitest'
import { formatInTimezone, zonedDateTimeToMs } from './timezone-tools'

describe('IANA 时区换算', () => {
  it('处理上海与非整点偏移时区', () => {
    const ms = zonedDateTimeToMs('2026-10-25 09:00:00', 'Asia/Shanghai')
    expect(new Date(ms).toISOString()).toBe('2026-10-25T01:00:00.000Z')
    expect(formatInTimezone(ms, 'Asia/Kolkata')).toContain('06:30:00')
  })
  it('夏令时缺口拒绝，重复时间必须选择', () => {
    expect(() => zonedDateTimeToMs('2026-03-08 02:30:00', 'America/New_York')).toThrow('不存在')
    expect(() => zonedDateTimeToMs('2026-11-01 01:30:00', 'America/New_York')).toThrow('重复')
    const early = zonedDateTimeToMs('2026-11-01 01:30:00', 'America/New_York', 'earlier')
    const late = zonedDateTimeToMs('2026-11-01 01:30:00', 'America/New_York', 'later')
    expect(late - early).toBe(3600000)
  })
  it('拒绝日期溢出、非法时间与未知时区', () => {
    for (const input of ['2026-02-30 09:00:00', '2026-10-25 25:00:00', 'bad'])
      expect(() => zonedDateTimeToMs(input, 'UTC')).toThrow()
    expect(() => zonedDateTimeToMs('2026-10-25 09:00:00', 'Invalid/Zone')).toThrow('时区无效')
  })
})
