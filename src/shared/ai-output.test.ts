import { describe, expect, it } from 'vitest'
import { JsonArrayObjectStream, passwordPreview } from './ai-output'

describe('结构化流式预览', () => {
  it('跨分片、转义与嵌套不会提前闭合或重复返回对象', () => {
    const parser = new JsonArrayObjectStream()
    const first = JSON.stringify({ title: '合成"}账号', data: [{ x: 1 }] })
    const split = first.indexOf('\\') + 1
    expect(parser.push('```json\n[' + first.slice(0, split))).toEqual([])
    expect(parser.push(first.slice(split) + ',')).toEqual([first])
    expect(parser.push('{"title":"第二条"}')).toEqual(['{"title":"第二条"}'])
    expect(parser.push(']\n```')).toEqual([])
    expect(parser.push('{"title":"数组外内容"}')).toEqual([])
  })
  it('预览白名单不包含密码或备注，原始输出有长度上限', () => {
    expect(
      passwordPreview({ title: '合成', account: 'a', url: '', password: 'fixture-only' })
    ).toEqual({ title: '合成', account: 'a', url: '', hasPassword: true })
    expect(() => new JsonArrayObjectStream().push('x'.repeat(200001))).toThrow('过长')
  })
})
