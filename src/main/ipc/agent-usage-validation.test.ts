import { describe, expect, it } from 'vitest'
import { validateUsageClient, validateUsageQuery } from './validation'

describe('用量 IPC 参数', () => {
  it('支持独立来源且拒绝原型字段', () => {
    expect(validateUsageClient('zcode')).toBe('zcode')
    expect(() => validateUsageClient('__proto__')).toThrow()
  })
  it.each([
    { from: '2026-02-30' },
    { from: '2026-10-25', to: '2026-10-24' },
    { offset: -1 },
    { offset: 0.1 },
    { refresh: 'yes' },
    { model: 'x'.repeat(4097) },
    { sort: 'model' },
    { sort: 1 },
    { desc: 'yes' },
    { limit: 0 },
    { limit: 5001 },
    { limit: 1.5 }
  ])('拒绝无效筛选 %j', (value) => {
    expect(() => validateUsageQuery(value)).toThrow()
  })
  it('接受有效的本地日历日期、排序与分页', () => {
    expect(validateUsageQuery({ from: '2026-10-24', offset: 50, client: 'kimi' })).toEqual({
      from: '2026-10-24',
      offset: 50,
      client: 'kimi'
    })
    expect(validateUsageQuery({ sort: 'total', desc: false, limit: 5000, refresh: true })).toEqual({
      sort: 'total',
      desc: false,
      limit: 5000,
      refresh: true
    })
  })
})
