import { describe, expect, it } from 'vitest'

import { ToolCallAccumulator, extractToolCallDeltas, toWireMessage } from './wire'

/** 构造一条带 tool_calls 的流式负载 */
function payload(calls: unknown[], finishReason?: string): unknown {
  return { choices: [{ delta: { tool_calls: calls }, finish_reason: finishReason ?? null }] }
}

describe('extractToolCallDeltas', () => {
  it('取出 tool_calls 增量', () => {
    const deltas = extractToolCallDeltas(
      payload([{ index: 0, id: 'call_a', function: { name: 'notes_list', arguments: '{}' } }])
    )
    expect(deltas).toEqual([
      { index: 0, id: 'call_a', name: 'notes_list', argumentsDelta: '{}' }
    ])
  })

  it('无 tool_calls 时返回空数组', () => {
    expect(extractToolCallDeltas({ choices: [{ delta: { content: 'hi' } }] })).toEqual([])
    expect(extractToolCallDeltas(null)).toEqual([])
    expect(extractToolCallDeltas({ choices: [] })).toEqual([])
  })

  it('缺失 index 时按数组下标兜底（部分网关单调用不写 index）', () => {
    const deltas = extractToolCallDeltas(payload([{ function: { name: 'x', arguments: '{}' } }]))
    expect(deltas[0]?.index).toBe(0)
  })

  it('忽略非法元素与非字符串字段', () => {
    const deltas = extractToolCallDeltas(
      payload([null, 'nope', { index: 2, function: { arguments: 12 } }])
    )
    expect(deltas).toEqual([{ index: 2, id: undefined, name: undefined, argumentsDelta: undefined }])
  })
})

describe('ToolCallAccumulator', () => {
  it('把跨事件的 arguments 片段拼成完整 JSON', () => {
    const accumulator = new ToolCallAccumulator()
    accumulator.push(payload([{ index: 0, id: 'call_a', function: { name: 'books_chapters' } }]))
    accumulator.push(payload([{ index: 0, function: { arguments: '{"bo' } }]))
    accumulator.push(payload([{ index: 0, function: { arguments: 'ok":"三体"}' } }]))
    // 中间夹一层只有 finish_reason 的负载，不能影响累加
    accumulator.push({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] })

    expect(accumulator.size).toBe(1)
    expect(accumulator.list()).toEqual([
      { id: 'call_a', name: 'books_chapters', arguments: '{"book":"三体"}' }
    ])
  })

  it('并行调用按 index 升序返回', () => {
    const accumulator = new ToolCallAccumulator()
    accumulator.push(
      payload([
        { index: 1, id: 'call_b', function: { name: 'two', arguments: '{}' } },
        { index: 0, id: 'call_a', function: { name: 'one', arguments: '{}' } }
      ])
    )
    expect(accumulator.list().map((call) => call.name)).toEqual(['one', 'two'])
  })

  it('名称被网关重复下发时不会拼成两遍', () => {
    const accumulator = new ToolCallAccumulator()
    accumulator.push(payload([{ index: 0, id: 'c', function: { name: 'notes_list' } }]))
    accumulator.push(payload([{ index: 0, function: { name: 'notes_list', arguments: '{}' } }]))
    expect(accumulator.list()[0]?.name).toBe('notes_list')
  })

  it('没有 id 时留空（由调用方兜底生成）', () => {
    const accumulator = new ToolCallAccumulator()
    accumulator.push(payload([{ index: 0, function: { name: 'x', arguments: '{}' } }]))
    expect(accumulator.list()[0]?.id).toBe('')
  })
})

describe('toWireMessage', () => {
  it('普通消息只带 role 与 content', () => {
    expect(toWireMessage({ role: 'user', content: '你好' })).toEqual({
      role: 'user',
      content: '你好'
    })
  })

  it('assistant 的 tool_calls 展开成 OpenAI 形状', () => {
    expect(
      toWireMessage({
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'call_a', name: 'notes_list', arguments: '{}' }]
      })
    ).toEqual({
      role: 'assistant',
      content: '',
      tool_calls: [{ id: 'call_a', type: 'function', function: { name: 'notes_list', arguments: '{}' } }]
    })
  })

  it('tool 结果带 tool_call_id', () => {
    expect(toWireMessage({ role: 'tool', content: 'ok', toolCallId: 'call_a' })).toEqual({
      role: 'tool',
      content: 'ok',
      tool_call_id: 'call_a'
    })
  })
})
