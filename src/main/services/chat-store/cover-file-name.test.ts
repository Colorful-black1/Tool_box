import { describe, expect, it } from 'vitest'

import { toCoverFileName } from './chat-store'

/**
 * 封面路径归一的纯函数测试。
 * chat-store 本身依赖 better-sqlite3（已按 Electron ABI 编译），无法在 vitest 中实例化，
 * 因此把可测逻辑抽成纯函数覆盖；迁移行为仍需手动验收。
 */
describe('toCoverFileName', () => {
  it('reduces a Windows absolute path to a file name', () => {
    expect(
      toCoverFileName('C:\\Users\\me\\AppData\\Roaming\\tool-box\\covers\\cover_a_1.png')
    ).toBe('cover_a_1.png')
  })

  it('reduces a POSIX absolute path to a file name', () => {
    expect(toCoverFileName('/home/me/.toolbox/covers/cover_b_2.jpg')).toBe('cover_b_2.jpg')
  })

  it('keeps a plain file name unchanged so migration stays idempotent', () => {
    expect(toCoverFileName('cover_c_3.webp')).toBe('cover_c_3.webp')
  })

  it('trims surrounding whitespace', () => {
    expect(toCoverFileName('  cover_d_4.png  ')).toBe('cover_d_4.png')
  })

  it('returns an empty string for blank input', () => {
    expect(toCoverFileName('')).toBe('')
    expect(toCoverFileName('   ')).toBe('')
  })

  it('is idempotent across repeated calls', () => {
    const once = toCoverFileName('C:\\data\\covers\\cover_e_5.png')
    expect(toCoverFileName(once)).toBe(once)
  })
})
