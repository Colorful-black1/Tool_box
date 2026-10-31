import { describe, expect, it } from 'vitest'
import type { PasswordEntryView } from './types'
import { analyzePasswordHealth } from './password-health'

const now = 1_800_000_000_000
function entry(
  id: string,
  password: string,
  patch: Partial<PasswordEntryView> = {}
): PasswordEntryView {
  return {
    id,
    title: id,
    password,
    account: '',
    url: '',
    remark: '',
    firstLetter: '#',
    isFavorite: false,
    isDecryptable: true,
    createdAtMs: now,
    updatedAtMs: now,
    ...patch
  }
}

describe('密码健康报告', () => {
  it('按精确明文分组，解密失败不参与，报告不包含明文', () => {
    const secret = 'DistinctStrong#1234'
    const report = analyzePasswordHealth(
      [
        entry('a', secret),
        entry('b', secret),
        entry('c', secret),
        entry('weak', '123'),
        entry('failed', secret, { isDecryptable: false }),
        entry('case', secret.toLowerCase())
      ],
      now
    )
    expect(report.duplicates.map((group) => group.map((item) => item.id))).toEqual([
      ['a', 'b', 'c']
    ])
    expect(report.weak.map((item) => item.id)).toEqual(['weak'])
    expect(report.failed).toBe(1)
    expect(JSON.stringify(report)).not.toContain(secret)
    expect(JSON.stringify(report)).not.toContain('password')
  })
  it('指标允许交集，空密码也参与重复与弱项；严格超过365天才过期', () => {
    const day = 86_400_000
    const report = analyzePasswordHealth(
      [
        entry('empty', ''),
        entry('empty2', ''),
        entry('boundary', 'StrongSecret#1234', { updatedAtMs: now - 365 * day }),
        entry('old', 'StrongSecret#5678', { updatedAtMs: now - 365 * day - 1 }),
        entry('future', 'FutureSecret#1234', { updatedAtMs: now + day })
      ],
      now
    )
    expect(report.empty).toHaveLength(2)
    expect(report.duplicates.map((group) => group.map((item) => item.id))).toEqual([
      ['empty', 'empty2']
    ])
    expect(report.stale.map((item) => item.id)).toEqual(['old'])
    expect(report.weak.map((item) => item.id)).toEqual(['empty', 'empty2'])
  })
  it('空库与健康库无风险项', () => {
    expect(analyzePasswordHealth([], now).total).toBe(0)
    expect(analyzePasswordHealth([entry('a', 'LongStrong!123456')], now)).toMatchObject({
      total: 1,
      failed: 0,
      duplicates: [],
      weak: [],
      stale: [],
      empty: []
    })
  })
})
