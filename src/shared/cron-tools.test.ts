import { describe, expect, it } from 'vitest'
import { formatCronTime, parseCronStart, previewCron } from './cron-tools'

const after = Date.parse('2026-10-22T00:00:00Z')
const next = (
  text: string,
  dialect: 'spring' | 'quartz' | 'unix' = 'spring',
  start = after
): string => new Date(previewCron(text, dialect, start, 0).times[0]).toISOString()

describe('Cron 方言与日期计算', () => {
  it('区分五/六/七段和星期编号，不把 Quartz 周一当 Spring 周一', () => {
    expect(next('0 0 9 * * 1')).toBe('2026-10-26T09:00:00.000Z')
    expect(next('0 0 9 ? * 1', 'quartz')).toBe('2026-10-25T09:00:00.000Z')
    expect(next('0 9 * * MON-FRI', 'unix')).toBe('2026-10-22T09:00:00.000Z')
    expect(next('0 0 9 ? * MON-FRI 2027', 'quartz')).toBe('2027-01-01T09:00:00.000Z')
    expect(() => previewCron('0 9 * * MON', 'spring', after)).toThrow('六段')
    expect(() => previewCron('0 0 9 * * MON', 'quartz', after)).toThrow('只能有一个')
  })
  it('支持范围、列表、步长、宏，起点本身不计入结果', () => {
    expect(next('*/15 * * * * *')).toBe('2026-10-22T00:00:15.000Z')
    expect(next('0/20 0-2 1,2 * OCT THU')).toBe('2026-10-22T01:00:00.000Z')
    expect(next('@hourly')).toBe('2026-10-22T01:00:00.000Z')
    const result = previewCron('* * * * * *', 'spring', after + 999, 0)
    expect(result.times).toHaveLength(10)
    expect(result.times[0]).toBe(after + 1000)
  })
  it('日与星期的 AND / OR 规则不同', () => {
    expect(next('0 0 0 1 * MON')).toBe('2027-02-01T00:00:00.000Z')
    expect(next('0 0 1 * MON', 'unix')).toBe('2026-10-26T00:00:00.000Z')
    expect(next('0 0 */2 * MON', 'unix')).toBe('2026-11-09T00:00:00.000Z')
  })
  it('月底、偏移、最近工作日、第几个与最后一个星期、闰日', () => {
    expect(next('0 0 0 L * *')).toBe('2026-10-31T00:00:00.000Z')
    expect(next('0 0 0 L-2 * *')).toBe('2026-10-29T00:00:00.000Z')
    expect(next('0 0 0 LW * *')).toBe('2026-10-30T00:00:00.000Z')
    expect(next('0 0 0 1W * *')).toBe('2026-11-02T00:00:00.000Z')
    expect(next('0 0 0 * * FRI#4')).toBe('2026-10-23T00:00:00.000Z')
    expect(next('0 0 0 * * FRIL')).toBe('2026-10-30T00:00:00.000Z')
    expect(next('0 0 0 29 FEB *')).toBe('2028-02-29T00:00:00.000Z')
    const may = Date.parse('2026-05-01T00:00:00Z')
    expect(next('0 0 0 31W * *', 'spring', may)).toBe('2026-07-31T00:00:00.000Z')
    expect(next('0 0 0 31W * ?', 'quartz', may)).toBe('2026-05-29T00:00:00.000Z')
    expect(previewCron('0 0 0 31 FEB *', 'spring', after).times).toEqual([])
  })
  it.each([
    '60 * * * * *',
    '0 0 24 * * *',
    '0 0 0 0 * *',
    '0 0 0 * 13 *',
    '*/0 * * * * *',
    '0 0 0 * * FRI#6',
    '0 0 0 32W * *',
    '0 0 0 * * 8',
    '0 0 0 * * ?/2'
  ])('拒绝非法字段 %s', (text) => {
    expect(() => previewCron(text, 'spring', after)).toThrow()
  })
  it('固定时区与无效日期校验，时区切换保持同一个绝对起点', () => {
    const start = parseCronStart('2026-10-22T08:00', 480)
    expect(start).toBe(after)
    expect(formatCronTime(start, 480)).toBe('2026-10-22 08:00:00')
    expect(() => parseCronStart('2026-02-30T12:00', 0)).toThrow()
    expect(previewCron('0 0 9 * * *', 'spring', start).times[0]).toBe(after + 3600000)
  })
})
