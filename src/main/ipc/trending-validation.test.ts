import { describe, expect, it } from 'vitest'

import { validateRepoFullName, validateTrendingQuery } from './validation'

describe('GitHub 热榜 IPC 校验', () => {
  it('接受合法周期、语言和缓存标记', () => {
    expect(
      validateTrendingQuery({
        period: 'weekly',
        language: 'typescript',
        force: true,
        allowStale: false
      })
    ).toEqual({
      period: 'weekly',
      language: 'typescript',
      force: true,
      allowStale: false
    })
    expect(validateTrendingQuery({ period: 'daily', language: '' })).toEqual({
      period: 'daily'
    })
  })

  it('拒绝未知周期、语言和非布尔标记', () => {
    expect(() => validateTrendingQuery({ period: 'yearly' })).toThrow('周期')
    expect(() => validateTrendingQuery({ period: 'daily', language: 'cobol' })).toThrow('语言')
    expect(() => validateTrendingQuery({ period: 'daily', force: 'yes' })).toThrow('布尔')
    expect(() => validateTrendingQuery({ period: 'daily', allowStale: 1 })).toThrow('布尔')
  })

  it('仓库名只接受 owner/repo，拒绝 URL 与路径穿越', () => {
    expect(validateRepoFullName('meta/astryx')).toBe('meta/astryx')
    expect(validateRepoFullName('a.b/c-d_e')).toBe('a.b/c-d_e')
    for (const value of [
      'https://github.com/meta/astryx',
      '../etc/passwd',
      'a/b/c',
      'a/',
      '/b',
      'a/..',
      'a/b?x=1'
    ]) {
      expect(() => validateRepoFullName(value)).toThrow('仓库名无效')
    }
  })
})
