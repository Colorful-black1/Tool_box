import { describe, expect, it } from 'vitest'
import { cleanJavaLog } from './java-log-tools'

const options = { expandEscapes: false, collapseRepeated: true, traceId: '' }
describe('Java 日志整理', () => {
  it('清理 ANSI、保留异常链并折叠连续重复行', () => {
    const result = cleanJavaLog(
      '\x1b[31mERROR\x1b[0m\r\nCaused by: java.io.IOException\n\tat demo.A.run(A.java:1)\n\tat demo.A.run(A.java:1)',
      options
    )
    expect(result.output).not.toContain('\x1b')
    expect(result.causes).toEqual(['Caused by: java.io.IOException'])
    expect(result.collapsed).toBe(1)
    expect(result.output).toContain('连续重复 2 次')
  })
  it('转义展开必须显式开启，路径默认保持原样', () => {
    const input = 'C:\\new\\test'
    expect(cleanJavaLog(input, options).output).toBe(input)
    expect(
      cleanJavaLog('first\\n\\tat demo.A.run(A.java:1)', { ...options, expandEscapes: true }).output
    ).toBe('first\n\tat demo.A.run(A.java:1)')
  })
  it('traceId 筛选保留对应堆栈，排除其他记录', () => {
    const input =
      'ERROR [trace-1] failed\n\tat demo.A.run(A.java:1)\nCaused by: IOException\nINFO [trace-2] ok'
    const result = cleanJavaLog(input, { ...options, traceId: 'trace-1' })
    expect(result.output).toContain('Caused by: IOException')
    expect(result.output).not.toContain('trace-2')
    expect(result.matchedRecords).toBe(1)
    expect(cleanJavaLog(input, { ...options, traceId: 'absent' }).output).toBe('')
  })
  it('完整 JSON 字符串只解码一次，不重复解释原本属于文本的反斜杠', () => {
    const content = 'literal \\n marker'
    expect(cleanJavaLog(JSON.stringify(content), { ...options, expandEscapes: true }).output).toBe(
      content
    )
  })
})
