import { describe, expect, it } from 'vitest'

import {
  decodeBase64,
  decodeUrl,
  dedupeLines,
  encodeBase64,
  encodeUrl,
  formatJson,
  formatTimestamp,
  generateUuid,
  generateUuidBatch,
  minifyJson,
  parseDateTime,
  parseTimestamp,
  sortLines,
  testRegex,
  textStats,
  trimLines
} from './dev-tools'

describe('Base64', () => {
  it('英文往返一致', () => {
    expect(decodeBase64(encodeBase64('hello toolbox'))).toBe('hello toolbox')
  })

  it('中文按 UTF-8 编码，不乱码', () => {
    const text = '私人百宝箱 · 星轨对话'
    // 手写实现必须与 Node 的 Buffer 完全一致
    expect(encodeBase64(text)).toBe(Buffer.from(text, 'utf8').toString('base64'))
    expect(decodeBase64(encodeBase64(text))).toBe(text)
  })

  it('与 Node Buffer 逐一对齐（含边界长度）', () => {
    for (const text of ['', 'a', 'ab', 'abc', 'abcd', '中文', 'a中b', '😀 emoji']) {
      expect(encodeBase64(text)).toBe(Buffer.from(text, 'utf8').toString('base64'))
      expect(decodeBase64(encodeBase64(text))).toBe(text)
    }
  })

  it('空串与空输入', () => {
    expect(encodeBase64('')).toBe('')
    expect(decodeBase64('')).toBe('')
  })

  it('补位正确', () => {
    expect(encodeBase64('a')).toBe('YQ==')
    expect(encodeBase64('ab')).toBe('YWI=')
    expect(encodeBase64('abc')).toBe('YWJj')
  })

  it('容忍空白与 URL 安全变体', () => {
    expect(decodeBase64('aGVs\nbG8=')).toBe('hello')
    // "hello?" 的 URL 安全变体（把 + / 换成 - _）
    expect(decodeBase64('aGVsbG8_')).toBe('hello?')
  })

  it('非法输入抛错', () => {
    expect(() => decodeBase64('!!!')).toThrow('Base64')
  })

  it('接受省略补位的完整字节', () => {
    expect(decodeBase64('YQ')).toBe('a')
    expect(decodeBase64('YWI')).toBe('ab')
  })

  it.each(['A', 'YWJjA', '=', 'YQ=', 'YWI==', 'YWJj=', 'YR==', 'YWJ='])(
    '拒绝非法长度、补位或非零填充位：%s',
    (text) => expect(() => decodeBase64(text)).toThrow('Base64')
  )

  it.each(['gA==', 'wA==', '4rg=', 'wK8=', '7aCA', '9JCAgA==', '/w=='])(
    '拒绝非法或截断的 UTF-8 字节：%s',
    (text) => expect(() => decodeBase64(text)).toThrow('UTF-8')
  )

  it('孤立代理项按 UTF-8 替换字符编码，与 Node 保持一致', () => {
    const text = '\ud800a\udfff'
    expect(encodeBase64(text)).toBe(Buffer.from(text, 'utf8').toString('base64'))
    expect(decodeBase64(encodeBase64(text))).toBe('\ufffda\ufffd')
  })
})

describe('URL 编解码', () => {
  it('往返一致', () => {
    expect(decodeUrl(encodeUrl('a b&c=d?e/中'))).toBe('a b&c=d?e/中')
  })

  it('空格编码成 %20', () => {
    expect(encodeUrl('a b')).toBe('a%20b')
  })

  it('非法转义抛错', () => {
    expect(() => decodeUrl('%E4%A')).toThrow('URL')
  })
})

describe('时间戳', () => {
  it('按本地时间格式化', () => {
    const date = new Date(2026, 9, 20, 21, 5, 9)
    expect(formatTimestamp(date.getTime())).toBe('2026-10-20 21:05:09')
  })

  it('10 位按秒、13 位按毫秒', () => {
    expect(parseTimestamp('1760000000')).toBe(1760000000000)
    expect(parseTimestamp('1760000000000')).toBe(1760000000000)
  })

  it('非纯数字返回 null', () => {
    expect(parseTimestamp('abc')).toBeNull()
    expect(parseTimestamp('')).toBeNull()
  })

  it('日期字符串可解析', () => {
    const ms = parseDateTime('2026-10-20 21:05:09')
    expect(ms).not.toBeNull()
    expect(formatTimestamp(ms as number)).toBe('2026-10-20 21:05:09')
    expect(parseDateTime('2026/10/20')).toBeNull()
  })

  it.each([
    '2026-02-31',
    '2026-02-29',
    '2026-04-31',
    '2026-00-01',
    '2026-13-01',
    '2026-01-00',
    '2026-01-01 24:00',
    '2026-01-01 12:60',
    '2026-01-01 12:00:60'
  ])('越界日期时间返回 null，不自动进位：%s', (text) => {
    expect(parseDateTime(text)).toBeNull()
  })

  it('接受闰年，并保留 0 到 99 年的实际年份', () => {
    expect(parseDateTime('2024-02-29 12:30')).not.toBeNull()
    const ms = parseDateTime('0099-01-01')
    expect(ms).not.toBeNull()
    expect(new Date(ms as number).getFullYear()).toBe(99)
  })

  it('拒绝超出 Date 范围的时间戳', () => {
    expect(parseTimestamp('8640000000000001')).toBeNull()
    expect(() => formatTimestamp(8640000000000001)).toThrow('时间戳')
  })
})

describe('JSON', () => {
  it('格式化与压缩', () => {
    const source = '{"b":1,"a":[2,3]}'
    expect(formatJson(source).output).toBe('{\n  "b": 1,\n  "a": [\n    2,\n    3\n  ]\n}')
    expect(minifyJson(source).output).toBe('{"b":1,"a":[2,3]}')
  })

  it('非法 JSON 给出错误而不是抛异常', () => {
    const result = formatJson('{oops')
    expect(result.ok).toBe(false)
    expect(result.error).toBeTruthy()
  })

  it('空输入给出提示', () => {
    expect(formatJson('   ').ok).toBe(false)
  })
})

describe('文本统计', () => {
  it('字符 / 行 / 词 / 段落', () => {
    const stats = textStats('hello world\n\n第二段有中文')
    expect(stats.chars).toBe(19)
    // 空格与两个换行都不算
    expect(stats.charsNoSpace).toBe(16)
    expect(stats.lines).toBe(3)
    // 英文按词（hello / world = 2）+ 中文按字（6）
    expect(stats.words).toBe(8)
    expect(stats.paragraphs).toBe(2)
  })

  it('空文本', () => {
    expect(textStats('')).toEqual({
      chars: 0,
      charsNoSpace: 0,
      lines: 0,
      words: 0,
      paragraphs: 0
    })
  })
})

describe('行处理', () => {
  it('去重保留首次顺序', () => {
    expect(dedupeLines('a\nb\na\n\nc')).toBe('a\nb\nc')
  })

  it('排序', () => {
    expect(sortLines('b\na\nc', 'asc')).toBe('a\nb\nc')
    expect(sortLines('b\na\nc', 'desc')).toBe('c\nb\na')
  })

  it('去首尾空白', () => {
    expect(trimLines('  a  \n b ')).toBe('a\nb')
  })
})

describe('UUID', () => {
  const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

  it('格式与版本位正确', () => {
    const uuid = generateUuid()
    expect(uuid).toMatch(UUID_V4)
    expect(uuid).toHaveLength(36)
  })

  it('批量生成条数正确且互不相同', () => {
    const list = generateUuidBatch(50)
    expect(list).toHaveLength(50)
    expect(new Set(list).size).toBe(50)
    for (const uuid of list) expect(uuid).toMatch(UUID_V4)
  })

  it('数量收敛到 1 ~ 1000', () => {
    expect(generateUuidBatch(0)).toHaveLength(1)
    expect(generateUuidBatch(-5)).toHaveLength(1)
    expect(generateUuidBatch(99999)).toHaveLength(1000)
  })
})

describe('正则测试', () => {
  it('返回命中位置', () => {
    const result = testRegex('a(b)', 'g', 'ab ab')
    expect(result.error).toBeUndefined()
    expect(result.matches.map((item) => item.index)).toEqual([0, 3])
    expect(result.matches[0].text).toBe('ab')
  })

  it('g 标志重复调用结果一致（无 lastIndex 残留）', () => {
    const first = testRegex('a', 'g', 'aaa')
    const second = testRegex('a', 'g', 'aaa')
    expect(first.matches).toHaveLength(3)
    expect(second.matches).toHaveLength(3)
  })

  it('零宽匹配不会死循环', () => {
    const result = testRegex('a*', 'g', 'bbb')
    expect(result.matches.length).toBeGreaterThan(0)
    expect(result.matches.length).toBeLessThanOrEqual(200)
  })

  it('表达式非法时给出错误', () => {
    const result = testRegex('(unclosed', '', 'text')
    expect(result.error).toBeTruthy()
    expect(result.matches).toHaveLength(0)
  })

  it('没有 g 或 y 时只返回第一次命中', () => {
    expect(testRegex('a', '', 'aaa').matches).toEqual([{ index: 0, length: 1, text: 'a' }])
    expect(testRegex('a*', '', 'bbb').matches).toHaveLength(1)
  })

  it('粘连模式只连续匹配，遇到不匹配的位置就停止', () => {
    expect(testRegex('a', 'y', 'aa ba').matches.map((match) => match.index)).toEqual([0, 1])
  })

  it('Unicode 零宽匹配按完整码点推进', () => {
    expect(testRegex('(?:)', 'gu', '😀a').matches.map((match) => match.index)).toEqual([0, 2, 3])
  })

  it('命中数量最多返回 200 条', () => {
    expect(testRegex('a', 'g', 'a'.repeat(201)).matches).toHaveLength(200)
  })
})
