import { describe, expect, it } from 'vitest'

import { SseParser, extractDelta, extractErrorMessage, extractMessageContent, isDoneSentinel } from './sse'

/** 把若干文本块按给定长度切片，用来模拟任意 chunk 边界 */
function chunk(text: string, size: number): string[] {
  const out: string[] = []
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size))
  return out
}

/** 用真实 SSE 文本跑解析器，返回所有事件 */
function parseAll(text: string, chunkSize = text.length): Array<{ event: string | null; data: string }> {
  const parser = new SseParser()
  const events: Array<{ event: string | null; data: string }> = []
  for (const piece of chunk(text, chunkSize)) events.push(...parser.push(piece))
  events.push(...parser.flush())
  return events
}

const DELTA = (content: string): string =>
  `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`

describe('SseParser', () => {
  it('解析标准 OpenAI 流', () => {
    const events = parseAll(`data: {"choices":[{"delta":{"content":"你好"}}]}\n\ndata: [DONE]\n\n`)
    expect(events).toHaveLength(2)
    expect(events[0]?.data).toBe('{"choices":[{"delta":{"content":"你好"}}]}')
    expect(events[1]?.data).toBe('[DONE]')
  })

  it('单个 chunk 里含多个事件时全部吐出', () => {
    const text = DELTA('a') + DELTA('b') + DELTA('c')
    const events = parseAll(text)
    expect(events).toHaveLength(3)
  })

  // 关键回归：网络分块与 SSE 边界无关，一个 JSON 会被切在任意位置
  it('任意 chunk 边界下解析结果一致', () => {
    const text = DELTA('星') + DELTA('轨') + DELTA('对话') + `data: [DONE]\n\n`
    for (const size of [1, 2, 3, 5, 7, 11, 13, 64]) {
      const events = parseAll(text, size)
      expect(events.map((e) => e.data)).toEqual([
        '{"choices":[{"delta":{"content":"星"}}]}',
        '{"choices":[{"delta":{"content":"轨"}}]}',
        '{"choices":[{"delta":{"content":"对话"}}]}',
        '[DONE]'
      ])
    }
  })

  it('忽略注释行（心跳）', () => {
    const events = parseAll(`: ping\n\n` + DELTA('x'))
    expect(events).toHaveLength(1)
    expect(events[0]?.data).toBe('{"choices":[{"delta":{"content":"x"}}]}')
  })

  it('支持 CRLF 行尾', () => {
    const events = parseAll(`data: {"choices":[{"delta":{"content":"a"}}]}\r\n\r\n`)
    expect(events).toHaveLength(1)
    expect(events[0]?.data).toBe('{"choices":[{"delta":{"content":"a"}}]}')
  })

  it('多行 data 用换行连接', () => {
    const events = parseAll('data: line1\ndata: line2\n\n')
    expect(events[0]?.data).toBe('line1\nline2')
  })

  it('只去掉冒号后的一个空格', () => {
    const events = parseAll('data:  two\n\n')
    expect(events[0]?.data).toBe(' two')
  })

  it('无冒号的行视为字段名，值为空', () => {
    const events = parseAll('data\ndata: real\n\n')
    expect(events[0]?.data).toBe('\nreal')
  })

  it('记录 event 字段', () => {
    const events = parseAll(`event: error\ndata: {"error":{"message":"boom"}}\n\n`)
    expect(events[0]?.event).toBe('error')
  })

  // 关键回归：部分服务端结尾不发空行，不 flush 会丢掉最后一段回复
  it('结尾无空行时靠 flush 吐出最后事件', () => {
    const parser = new SseParser()
    // 结尾只有一个 \n，没有构成事件分隔所需的空行
    expect(parser.push(`data: {"choices":[{"delta":{"content":"最后一段"}}]}\n`)).toHaveLength(0)
    const flushed = parser.flush()
    expect(flushed).toHaveLength(1)
    expect(flushed[0]?.data).toBe('{"choices":[{"delta":{"content":"最后一段"}}]}')
  })

  it('最后一行连换行都没有也能吐出', () => {
    const parser = new SseParser()
    expect(parser.push(`data: {"choices":[{"delta":{"content":"x"}}]}`)).toHaveLength(0)
    expect(parser.flush()).toHaveLength(1)
  })

  it('空输入不产生事件', () => {
    const parser = new SseParser()
    expect(parser.push('')).toHaveLength(0)
    expect(parser.flush()).toHaveLength(0)
  })

  it('isDoneSentinel 只认 [DONE]', () => {
    expect(isDoneSentinel({ event: null, data: '[DONE]' })).toBe(true)
    expect(isDoneSentinel({ event: null, data: ' [DONE] ' })).toBe(true)
    expect(isDoneSentinel({ event: null, data: '{"choices":[]}' })).toBe(false)
  })
})

describe('extractDelta', () => {
  it('取 choices[0].delta.content', () => {
    expect(extractDelta({ choices: [{ delta: { content: '你好' } }] })).toBe('你好')
  })

  // 关键回归：首 chunk 只有 role、末 chunk 只有 finish_reason
  it('无 content 时返回空串', () => {
    expect(extractDelta({ choices: [{ delta: { role: 'assistant' } }] })).toBe('')
    expect(extractDelta({ choices: [{ delta: {}, finish_reason: 'stop' }] })).toBe('')
    expect(extractDelta({ choices: [] })).toBe('')
    expect(extractDelta({})).toBe('')
    expect(extractDelta(null)).toBe('')
  })

  it('兼容 content 为多模态数组', () => {
    expect(
      extractDelta({
        choices: [{ delta: { content: [{ type: 'text', text: '前半' }, { type: 'text', text: '后半' }] } }]
      })
    ).toBe('前半后半')
  })
})

describe('extractMessageContent', () => {
  it('取非流式的 choices[0].message.content', () => {
    expect(extractMessageContent({ choices: [{ message: { content: '完整回复' } }] })).toBe('完整回复')
    expect(extractMessageContent({ choices: [{ message: {} }] })).toBe('')
  })
})

describe('extractErrorMessage', () => {
  it('取 error.message', () => {
    expect(extractErrorMessage({ error: { message: 'Invalid API key' } })).toBe('Invalid API key')
  })

  it('error 为字符串时直接取', () => {
    expect(extractErrorMessage({ error: 'boom' })).toBe('boom')
  })

  it('取顶层 message', () => {
    expect(extractErrorMessage({ message: 'quota exceeded' })).toBe('quota exceeded')
  })

  it('无错误返回 null', () => {
    expect(extractErrorMessage({ choices: [{ delta: { content: 'a' } }] })).toBeNull()
    expect(extractErrorMessage(null)).toBeNull()
    expect(extractErrorMessage({ error: {} })).toBeNull()
  })
})