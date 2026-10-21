import { describe, expect, it } from 'vitest'
import {
  expandJsonStrings,
  extractJsonPath,
  formatLosslessJson,
  parseLosslessJson
} from './json-tools'

describe('无损 JSON 工具', () => {
  it('保留长整型、小数、负零和指数原文', () => {
    const input = '{"id":9223372036854775807,"n":-0,"price":1.2300,"exponent":1e400}'
    expect(formatLosslessJson(input, 0)).toBe(input)
    expect(formatLosslessJson(input)).toContain('9223372036854775807')
  })
  it('排序特殊字段，不改变数组顺序或对象原型', () => {
    expect(formatLosslessJson('{"z":[2,1],"__proto__":{"x":true},"a":null}', 0, true)).toBe(
      '{"__proto__":{"x":true},"a":null,"z":[2,1]}'
    )
  })
  it.each([
    '01',
    '1.',
    '1e',
    '[1,]',
    '{"a":1,}',
    'true false',
    '"a\nb"',
    '{"a":1,"\\u0061":2}',
    '\ufeff{}'
  ])('拒绝非法或重复字段输入 %j', (input) => {
    expect(() => parseLosslessJson(input)).toThrow()
  })
  it('限制长度和嵌套，错误不包含输入值', () => {
    expect(() => parseLosslessJson(' '.repeat(200001))).toThrow('过长')
    expect(() => parseLosslessJson('['.repeat(66) + '0' + ']'.repeat(66))).toThrow('嵌套')
    expect(() => parseLosslessJson('{"private":"sensitive-value",')).toThrow('结束括号')
  })
  it('常用 JSON 与原生格式化一致', () => {
    for (const input of [
      '{}',
      '[]',
      'null',
      'true',
      '"中文\\n😀"',
      '{"a":[1,false,null,{"b":"x"}]}'
    ]) {
      expect(formatLosslessJson(input)).toBe(JSON.stringify(JSON.parse(input), null, 2))
    }
  })
  it('确定性生成的普通 JSON 与独立原生解析器逐项一致', () => {
    let seed = 137
    const next = (): number => {
      seed = (seed * 16807) % 2147483647
      return seed
    }
    const generate = (depth: number): unknown => {
      const kind = next() % (depth ? 6 : 4)
      if (kind === 0) return (next() % 100000) - 50000
      if (kind === 1) return '中文 😀 " \\ \n\t' + next()
      if (kind === 2) return next() % 2 === 0
      if (kind === 3) return null
      if (kind === 4) return Array.from({ length: next() % 5 }, () => generate(depth - 1))
      return { first: generate(depth - 1), second: generate(depth - 1) }
    }
    for (let i = 0; i < 100; i++) {
      const value = generate(4)
      expect(formatLosslessJson(JSON.stringify(value))).toBe(JSON.stringify(value, null, 2))
    }
  })
  it('提取带点键、数组下标与通配符，并保留长整数', () => {
    const text = '{"data.items":[{"id":9223372036854775807},{"id":2}]}'
    expect(extractJsonPath(text, "$['data.items'][0].id")).toBe('9223372036854775807')
    expect(extractJsonPath(text, '$["data.items"][*].id')).toBe('[\n  9223372036854775807,\n  2\n]')
    expect(extractJsonPath(text, '$.missing')).toBe('[]')
  })
  it.each(['$.x[?(@.x)]', '$..x', 'x', '$[-1]', '$[0:3]'])('拒绝未支持的路径 %s', (path) => {
    expect(() => extractJsonPath('{}', path)).toThrow()
  })
  it('路径字符串出错时不回显内容', () => {
    expect(() => extractJsonPath('{}', '$["\\q"]')).toThrow('路径字符串转义无效')
  })
  it('解除字符串与嵌套 JSON 字符串，普通字符串不变', () => {
    expect(expandJsonStrings('"hello\\nworld"')).toBe('hello\nworld')
    expect(
      expandJsonStrings('{"data":"{\\"id\\":9223372036854775807}","text":"{unfinished"}')
    ).toContain('"id": 9223372036854775807')
    expect(expandJsonStrings('{"text":"{unfinished"}')).toContain('"{unfinished"')
  })
})
