import { describe, expect, it } from 'vitest'

import {
  MAX_BOOK_BYTES,
  UnsupportedTextEncodingError,
  decodeBookText,
  decodeUtf16,
  detectBom,
  isValidUtf8,
  looksLikeUtf16
} from './text-decoder'

/** 手工拼字节数组，便于精确构造 BOM 与非法序列 */
function raw(...values: number[]): Uint8Array {
  return new Uint8Array(values)
}

function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

/** 按指定字节序把 JS 字符串编成 UTF-16 字节 */
function utf16(text: string, littleEndian: boolean): Uint8Array {
  const units: number[] = []
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0
    if (code > 0xffff) {
      // 代理对
      const adjusted = code - 0x10000
      units.push(0xd800 + (adjusted >> 10), 0xdc00 + (adjusted & 0x3ff))
    } else {
      units.push(code)
    }
  }
  const out = new Uint8Array(units.length * 2)
  units.forEach((unit, index) => {
    if (littleEndian) {
      out[index * 2] = unit & 0xff
      out[index * 2 + 1] = unit >> 8
    } else {
      out[index * 2] = unit >> 8
      out[index * 2 + 1] = unit & 0xff
    }
  })
  return out
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

const GBK_CHINESE = raw(0xd6, 0xd0, 0xce, 0xc4) // 「中文」的 GBK 编码

describe('detectBom', () => {
  it('识别三种 BOM 并给出长度', () => {
    expect(detectBom(concat(raw(0xef, 0xbb, 0xbf), utf8('a')))).toEqual({
      encoding: 'UTF-8',
      length: 3
    })
    expect(detectBom(concat(raw(0xff, 0xfe), utf8('a')))).toEqual({
      encoding: 'UTF-16LE',
      length: 2
    })
    expect(detectBom(concat(raw(0xfe, 0xff), utf8('a')))).toEqual({
      encoding: 'UTF-16BE',
      length: 2
    })
  })

  it('没有 BOM 时返回 null', () => {
    expect(detectBom(utf8('第一章'))).toBeNull()
    expect(detectBom(raw(0xef))).toBeNull()
  })
})

describe('decodeBookText', () => {
  it('UTF-8 带 BOM：BOM 不进正文', () => {
    const bytes = concat(raw(0xef, 0xbb, 0xbf), utf8('第一章 起点'))
    const result = decodeBookText(bytes)
    expect(result.encoding).toBe('UTF-8')
    expect(result.text).toBe('第一章 起点')
  })

  it('UTF-8 不带 BOM', () => {
    const result = decodeBookText(utf8('纯 UTF-8 内容'))
    expect(result.encoding).toBe('UTF-8')
    expect(result.text).toBe('纯 UTF-8 内容')
  })

  it('UTF-16 LE / BE 带 BOM', () => {
    const le = decodeBookText(concat(raw(0xff, 0xfe), utf16('第一章 起点', true)))
    expect(le.encoding).toBe('UTF-16LE')
    expect(le.text).toBe('第一章 起点')

    const be = decodeBookText(concat(raw(0xfe, 0xff), utf16('第一章 起点', false)))
    expect(be.encoding).toBe('UTF-16BE')
    expect(be.text).toBe('第一章 起点')
  })

  it('UTF-16 无 BOM 时按 NUL 分布嗅探', () => {
    const le = decodeBookText(utf16('第一章 无 BOM 的 UTF16 文本', true))
    expect(le.encoding).toBe('UTF-16LE')
    expect(le.text).toBe('第一章 无 BOM 的 UTF16 文本')

    const be = decodeBookText(utf16('第一章 无 BOM 的 UTF16 文本', false))
    expect(be.encoding).toBe('UTF-16BE')
    expect(be.text).toBe('第一章 无 BOM 的 UTF16 文本')
  })

  // 关键行为：GBK 明确报错，而不是静默按 latin1 / UTF-8 兜底出一片乱码
  it('GBK / ANSI 抛 UnsupportedTextEncodingError', () => {
    expect(() => decodeBookText(GBK_CHINESE)).toThrow(UnsupportedTextEncodingError)
    expect(() => decodeBookText(GBK_CHINESE)).toThrow(/转存为 UTF-8/)
  })

  it('空内容不报错', () => {
    expect(decodeBookText(utf8('')).text).toBe('')
  })

  it('超过体积上限直接拦下', () => {
    expect(() => decodeBookText(new Uint8Array(MAX_BOOK_BYTES + 1))).toThrow(/MB/)
  })

  it('emoji 等 4 字节码点正常解码', () => {
    const result = decodeBookText(utf8('第 🌌 一章'))
    expect(result.text).toBe('第 🌌 一章')
  })
})

describe('looksLikeUtf16', () => {
  it('纯 ASCII 的 UTF-16 文本能嗅出字节序', () => {
    expect(looksLikeUtf16(utf16('hello world', true))).toBe('UTF-16LE')
    expect(looksLikeUtf16(utf16('hello world', false))).toBe('UTF-16BE')
  })

  it('普通 UTF-8 中文不被误判', () => {
    expect(looksLikeUtf16(utf8('第一章 这是普通的中文 TXT 内容，不含任何 NUL 字节。'))).toBeNull()
  })

  it('太短的字节流不下结论', () => {
    expect(looksLikeUtf16(raw(0x68, 0x00))).toBeNull()
  })
})

describe('isValidUtf8', () => {
  it('接受合法多字节序列', () => {
    expect(isValidUtf8(utf8('中文 abc 🌌'))).toBe(true)
  })

  it('拒绝 GBK 的双字节高位序列', () => {
    expect(isValidUtf8(GBK_CHINESE)).toBe(false)
  })

  it('拒绝过长编码 C0/C1', () => {
    expect(isValidUtf8(raw(0xc0, 0x80))).toBe(false)
    expect(isValidUtf8(raw(0xc1, 0xbf))).toBe(false)
  })

  it('拒绝 UTF-16 代理区码点 ED A0..BF', () => {
    expect(isValidUtf8(raw(0xed, 0xa0, 0x80))).toBe(false)
  })

  it('拒绝超出 U+10FFFF 的 F5..FF', () => {
    expect(isValidUtf8(raw(0xf5, 0x80, 0x80, 0x80))).toBe(false)
    expect(isValidUtf8(raw(0xff))).toBe(false)
  })

  it('拒绝落单续字节', () => {
    expect(isValidUtf8(raw(0x80))).toBe(false)
    expect(isValidUtf8(raw(0x41, 0xbf))).toBe(false)
  })

  it('拒绝被截断的序列', () => {
    expect(isValidUtf8(raw(0xe4, 0xb8))).toBe(false)
    expect(isValidUtf8(raw(0xf0, 0x9f, 0x8c))).toBe(false)
  })
})

describe('decodeUtf16', () => {
  it('按字节序还原 ASCII 与中文', () => {
    expect(decodeUtf16(utf16('AB 中文', true), true)).toBe('AB 中文')
    expect(decodeUtf16(utf16('AB 中文', false), false)).toBe('AB 中文')
  })

  it('代理对还原成单个字符', () => {
    expect(decodeUtf16(utf16('🌌', true), true)).toBe('🌌')
  })

  it('落单代理项替换为 U+FFFD，不产生不可见字符', () => {
    // 只有高代理项，没有低代理项
    expect(decodeUtf16(raw(0x00, 0xd8), true)).toBe('\ufffd')
    // 只有低代理项
    expect(decodeUtf16(raw(0x00, 0xdc), true)).toBe('\ufffd')
  })

  it('奇数长度时忽略末尾残字节', () => {
    expect(decodeUtf16(raw(0x41, 0x00, 0x42), true)).toBe('A')
  })
})
