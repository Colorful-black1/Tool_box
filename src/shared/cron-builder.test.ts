import { describe, expect, it } from 'vitest'
import { parseCronStart } from './cron-tools'
import {
  buildCronExpression,
  cronFieldsFromTime,
  defaultCronFields,
  normalizeCronFields
} from './cron-builder'

describe('Cron 可视化生成', () => {
  it('三种方言的默认工作日九点表达式', () => {
    expect(buildCronExpression('spring', defaultCronFields('spring'))).toBe(
      '0 0 9 * * MON-FRI'
    )
    expect(buildCronExpression('quartz', defaultCronFields('quartz'))).toBe(
      '0 0 9 ? * MON-FRI *'
    )
    expect(buildCronExpression('unix', defaultCronFields('unix'))).toBe('0 9 * * MON-FRI')
  })
  it('间隔、范围与指定值按字段拼接', () => {
    const fields = defaultCronFields('unix')
    fields.minute = { ...fields.minute, mode: 'step', start: '0', step: '15' }
    fields.hour = { ...fields.hour, mode: 'range', from: '9', to: '18' }
    fields.week = { ...fields.week, mode: 'list', list: 'MON,WED,FRI' }
    expect(buildCronExpression('unix', fields)).toBe('0/15 9-18 * * MON,WED,FRI')
  })
  it('周字段支持步长，年份支持范围', () => {
    const fields = defaultCronFields('quartz')
    fields.week = { ...fields.week, mode: 'step', start: 'MON', step: '2' }
    fields.year = { ...fields.year, mode: 'range', from: '2026', to: '2030' }
    expect(buildCronExpression('quartz', fields)).toBe('0 0 9 ? * MON/2 2026-2030')
  })
  it('指定值去重并排序', () => {
    const fields = defaultCronFields('spring')
    fields.month = { ...fields.month, mode: 'list', list: '10, 1, 4, 7, 1' }
    expect(buildCronExpression('spring', fields)).toBe('0 0 9 * 1,4,7,10 MON-FRI')
  })
  it('切换方言时修正 Quartz 的日/周问号，切回后恢复星号', () => {
    const quartz = normalizeCronFields(defaultCronFields('spring'), 'quartz')
    expect(quartz.day.mode).toBe('unspecified')
    expect(buildCronExpression('quartz', quartz)).toBe('0 0 9 ? * MON-FRI *')
    const spring = normalizeCronFields(quartz, 'spring')
    expect(spring.day.mode).toBe('every')
    expect(buildCronExpression('spring', spring)).toBe('0 0 9 * * MON-FRI')
  })
  it('由具体时刻填入年月日时分秒', () => {
    const time = parseCronStart('2026-11-01T09:30:15', 480)
    expect(buildCronExpression('quartz', cronFieldsFromTime(time, 'quartz', 480))).toBe(
      '15 30 9 1 11 ? 2026'
    )
    expect(buildCronExpression('spring', cronFieldsFromTime(time, 'spring', 480))).toBe(
      '15 30 9 1 11 *'
    )
    expect(buildCronExpression('unix', cronFieldsFromTime(time, 'unix', 480))).toBe(
      '30 9 1 11 *'
    )
  })
  it('拒绝反向范围、零步长、空指定值与重复问号', () => {
    const range = defaultCronFields('spring')
    range.minute = { ...range.minute, mode: 'range', from: '30', to: '10' }
    expect(() => buildCronExpression('spring', range)).toThrow('结束值')
    const step = defaultCronFields('spring')
    step.minute = { ...step.minute, mode: 'step', start: '0', step: '0' }
    expect(() => buildCronExpression('spring', step)).toThrow('间隔')
    const list = defaultCronFields('spring')
    list.minute = { ...list.minute, mode: 'list', list: '' }
    expect(() => buildCronExpression('spring', list)).toThrow('指定值')
    const unset = defaultCronFields('quartz')
    unset.week = { ...unset.week, mode: 'unspecified' }
    expect(() => buildCronExpression('quartz', unset)).toThrow('只能有一个')
  })
})
