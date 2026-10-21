import { describe, expect, it } from 'vitest'

import {
  DEFAULT_PASSWORD_OPTIONS,
  generatePassword,
  passwordStrength
} from './password-generator'

describe('generatePassword', () => {
  it('长度符合要求', () => {
    expect([...generatePassword()]).toHaveLength(16)
    expect([...generatePassword({ ...DEFAULT_PASSWORD_OPTIONS, length: 24 })]).toHaveLength(24)
  })

  it('长度越界时收敛到 8 ~ 64', () => {
    expect([...generatePassword({ ...DEFAULT_PASSWORD_OPTIONS, length: 2 })]).toHaveLength(8)
    expect([...generatePassword({ ...DEFAULT_PASSWORD_OPTIONS, length: 999 })]).toHaveLength(64)
  })

  it('每类选中的字符都至少出现一次', () => {
    const password = generatePassword()
    expect(password).toMatch(/[a-z]/)
    expect(password).toMatch(/[A-Z]/)
    expect(password).toMatch(/[0-9]/)
  })

  it('排除易混字符后不再出现它们', () => {
    for (let i = 0; i < 50; i += 1) {
      const password = generatePassword({ ...DEFAULT_PASSWORD_OPTIONS, length: 32 })
      expect(password).not.toMatch(/[0O1lI|]/)
    }
  })

  it('关闭某类字符后不会出现该类', () => {
    const password = generatePassword({
      ...DEFAULT_PASSWORD_OPTIONS,
      useSymbols: false,
      useDigits: false,
      length: 32
    })
    expect(password).not.toMatch(/[0-9]/)
    expect(password).not.toMatch(/[^A-Za-z]/)
  })

  it('字符位置是打乱的（不会每类都排在最前）', () => {
    const samples = Array.from({ length: 20 }, () =>
      generatePassword({ ...DEFAULT_PASSWORD_OPTIONS, length: 12 })
    )
    // 20 次里至少有一次「首字符不是小写字母开头的小写集合」——
    // 更实际的做法：检查首字符不全是大写，说明没有简单按类别拼接
    expect(samples.some((item) => /[a-z]/.test(item[0]))).toBe(true)
    expect(samples.some((item) => /[^a-z]/.test(item[0]))).toBe(true)
  })

  it('一类字符都不选时报错', () => {
    expect(() =>
      generatePassword({
        ...DEFAULT_PASSWORD_OPTIONS,
        useLower: false,
        useUpper: false,
        useDigits: false,
        useSymbols: false
      })
    ).toThrow('字符类型')
  })

  it('多次生成结果不同', () => {
    const set = new Set(Array.from({ length: 20 }, () => generatePassword()))
    expect(set.size).toBeGreaterThan(15)
  })
})

describe('passwordStrength', () => {
  it('空密码最弱', () => {
    const result = passwordStrength('')
    expect(result.score).toBe(0)
    expect(result.hints.length).toBeGreaterThan(0)
  })

  it('短密码提示加长', () => {
    expect(passwordStrength('a1').hints).toContain('太短，建议至少 8 位')
  })

  it('长且字符种类多的密码很强', () => {
    const result = passwordStrength('Xy7#kQ2!mZp9@rLt')
    expect(result.score).toBe(4)
    expect(result.hints).toEqual([])
  })

  it('重复字符偏多会提示', () => {
    expect(passwordStrength('aaaaaaaaaaaa').hints).toContain('重复字符偏多')
  })

  it('单一类型会提示', () => {
    expect(passwordStrength('abcdefghijklmnop').hints).toContain('只用了单一类型的字符')
  })
})
