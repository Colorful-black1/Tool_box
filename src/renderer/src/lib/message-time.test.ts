import { describe, expect, it } from 'vitest'

import { formatMessageDateTime } from './message-time'

describe('formatMessageDateTime', () => {
  const now = new Date(2026, 10, 27, 9, 30).getTime()

  it('同年省略年份，并补齐分钟', () => {
    const timestamp = new Date(2026, 10, 6, 14, 6).getTime()
    expect(formatMessageDateTime(timestamp, now)).toBe('11月6日 14:06')
  })

  it('跨年补全年份', () => {
    const timestamp = new Date(2025, 10, 6, 14, 6).getTime()
    expect(formatMessageDateTime(timestamp, now)).toBe('2025年11月6日 14:06')
  })

  it('午夜与个位分钟也补零', () => {
    const timestamp = new Date(2026, 0, 1, 0, 5).getTime()
    expect(formatMessageDateTime(timestamp, now)).toBe('1月1日 00:05')
  })

  it('非法时间返回空串', () => {
    expect(formatMessageDateTime(Number.NaN, now)).toBe('')
    expect(formatMessageDateTime(Number.POSITIVE_INFINITY, now)).toBe('')
  })
})
