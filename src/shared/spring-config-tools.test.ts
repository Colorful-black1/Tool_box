import { describe, expect, it } from 'vitest'
import { compareSpringConfig, convertSpringConfig, parseSpringConfig } from './spring-config-tools'

describe('Spring 配置转换', () => {
  it('嵌套与标量/对象列表往返，保留长整数、占位符、URL 与字符串', () => {
    const yaml = `server:\n  port: 8080\napp:\n  id: 9223372036854775807\n  url: \${DB_URL:jdbc:h2:mem:test}\n  empty: ''\n  list:\n    - name: first\n      enabled: true\n    - name: second\n      enabled: false\n  tags:\n    - alpha\n    - beta`
    const properties = convertSpringConfig(yaml, 'yaml')
    expect(properties).toContain('app.id=9223372036854775807')
    expect(properties).toContain('app.url=${DB_URL:jdbc:h2:mem:test}')
    expect(properties).toContain('app.list[1].name=second')
    expect(parseSpringConfig(convertSpringConfig(properties, 'properties'), 'yaml')).toEqual(
      parseSpringConfig(yaml, 'yaml')
    )
  })
  it('支持 Java Properties 转义、空白/冒号分隔、续行、注释及空值', () => {
    const parsed = parseSpringConfig(
      '# comment\na\\:b : \\u4e2d\\n文\nempty=\ncontinued=hello\\\n   world\nspace value\nslash=\\\\path',
      'properties'
    )
    expect(parsed.get('a:b')).toBe('中\n文')
    expect(parsed.get('continued')).toBe('helloworld')
    expect(parsed.get('space')).toBe('value')
    expect(parsed.get('slash')).toBe('\\path')
    const back = convertSpringConfig(
      convertSpringConfig('a=\\ leading\\ttext\nb=1', 'properties'),
      'yaml'
    )
    expect(parseSpringConfig(back, 'properties').get('a')).toBe(' leading\ttext')
  })
  it('引号内注释符、冒号、转义和引号不截断', () => {
    const parsed = parseSpringConfig(
      `a: 'it''s # fine' # comment\nb: "https://example.test/a#b"\nc: 'x: y'`,
      'yaml'
    )
    expect(parsed.get('a')).toBe("it's # fine")
    expect(parsed.get('b')).toBe('https://example.test/a#b')
    expect(parsed.get('c')).toBe('x: y')
    expect(parseSpringConfig("message: don't truncate # comment", 'yaml').get('message')).toBe(
      "don't truncate"
    )
  })
  it.each([
    'a: 1\na: 2',
    'a: &anchor 1',
    'a: *anchor',
    'a: !!str 1',
    'a: [a, b]',
    'a: |\n  multiline',
    'a: null',
    'a:\n  b: 1\n---\na: 2',
    'a:\n b: 1\n  c: 2',
    'a:',
    'a: "open'
  ])('拒绝有损或非法 YAML %s', (source) => {
    expect(() => convertSpringConfig(source, 'yaml')).toThrow()
  })
  it.each(['a=1\na=2', 'a=1\na.b=2', 'a[1]=x', 'a[0]=x\na.b=y', 'a..b=x', 'a=\\uXYZ1'])(
    '拒绝重复或冲突的 Properties %s',
    (source) => {
      expect(() => convertSpringConfig(source, 'properties')).toThrow()
    }
  )
  it('外部键不会修改原型，比较分别报告新增/缺失/值不同', () => {
    expect(() => convertSpringConfig('[0].name=x', 'properties')).toThrow('顶层')
    expect(convertSpringConfig('__proto__.value=test', 'properties')).toContain('__proto__')
    expect(Object.hasOwn(Object.prototype, 'value')).toBe(false)
    const left = parseSpringConfig('same=1\na=1\nleft=2', 'properties')
    const right = parseSpringConfig('same: 1\na: 2\nright: 3', 'yaml')
    const diff = compareSpringConfig(left, right)
    expect(diff).toContain('仅左侧  left')
    expect(diff).toContain('仅右侧  right')
    expect(diff).toContain('值不同  a')
    expect(diff).not.toContain('same')
    expect(compareSpringConfig(left, left)).toBe('配置字段和值一致')
  })
})
