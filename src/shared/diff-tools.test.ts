import { describe, expect, it } from 'vitest'
import { compareJson, compareText } from './diff-tools'

describe('差异比较', () => {
  it('插入行不把后续行都判为修改', () => {
    expect(compareText('a\nb', 'a\nx\nb').lines).toEqual([
      { kind: 'same', text: 'a', beforeLine: 1, afterLine: 1 },
      { kind: 'added', text: 'x', beforeLine: undefined, afterLine: 2 },
      { kind: 'same', text: 'b', beforeLine: 2, afterLine: 3 }
    ])
  })
  it('支持空文本、删除和忽略空白', () => {
    expect(compareText('', '').lines).toEqual([])
    expect(compareText('x', '').lines[0].kind).toBe('removed')
    expect(compareText(' a b ', 'ab', true).lines[0].kind).toBe('same')
  })
  it('比较结果能够完整重建两侧内容', () => {
    for (let i = 0; i < 80; i++) {
      const before = Array.from({ length: i % 9 }, (_, j) => String((j + i) % 5)).join('\n')
      const after = Array.from({ length: (i + 3) % 11 }, (_, j) => String((j * 3 + i) % 7)).join(
        '\n'
      )
      const { lines } = compareText(before, after)
      expect(
        lines
          .filter((line) => line.kind !== 'added')
          .map((line) => line.text)
          .join('\n')
      ).toBe(before)
      expect(
        lines
          .filter((line) => line.kind !== 'removed')
          .map((line) => line.text)
          .join('\n')
      ).toBe(after)
    }
  })
  it('大文本采用分段，保留公共前后缀与行号', () => {
    const before = Array.from({ length: 1100 }, (_, i) => String(i)).join('\n')
    const result = compareText(before, before.replace('\n500\n', '\nchanged\n'))
    expect(result.coarse).toBe(true)
    expect(result.lines.filter((line) => line.kind !== 'same')).toHaveLength(2)
    expect(result.lines.at(-1)?.afterLine).toBe(1100)
  })
  it('对象忽略字段顺序，精确比较长整型', () => {
    expect(compareJson('{"a":1,"b":2}', '{"b":2,"a":1}').changes).toEqual([])
    expect(
      compareJson('{"id":9223372036854775807}', '{"id":9223372036854775806}').changes[0]
    ).toMatchObject({
      kind: 'changed',
      before: '9223372036854775807',
      after: '9223372036854775806'
    })
  })
  it('区分缺失、null、数组顺序并按字段名忽略', () => {
    expect(compareJson('{"x":null}', '{}').changes[0].kind).toBe('removed')
    expect(compareJson('[1,2]', '[2,1]').changes).toHaveLength(2)
    expect(
      compareJson('{"nested":{"updatedAt":1}}', '{"nested":{"updatedAt":2}}', ['updatedAt']).changes
    ).toEqual([])
  })
  it('长路径预览有界，避免多项差异放大长字段名', () => {
    const key = 'k'.repeat(5000)
    const result = compareJson(JSON.stringify({ [key]: [1, 2] }), JSON.stringify({ [key]: [3, 4] }))
    expect(result.changes).toHaveLength(2)
    expect(result.changes.every((change) => change.path.length < 1050)).toBe(true)
    expect(result.changes[0].path).toContain('路径截断')
  })
  it('特殊字段安全，差异数量有限且显示截断', () => {
    expect(compareJson('{}', '{"__proto__":1}').changes[0].path).toBe('$["__proto__"]')
    expect(compareJson('[]', '[' + Array(310).fill('1').join(',') + ']')).toMatchObject({
      truncated: true
    })
  })
})
