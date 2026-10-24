import { describe, expect, it } from 'vitest'
import { UsageLogParser } from './jsonl-parser'
import type { UsageClient } from '../../../shared/agent-usage'

function parse(client: UsageClient, rows: unknown[]) {
  const parser = new UsageLogParser(client, '/synthetic/session/wire.jsonl')
  rows.forEach((row, i) => parser.accept(row, i + 1))
  return parser.finish().filter((row) => !row.snapshot)
}

describe('本地日志采集规则', () => {
  const usage = { input_tokens: 100, output_tokens: 20, cached_input_tokens: 80, total_tokens: 120 }
  it('Codex 新旧事件共存只计新版，并去重重放', () => {
    const event = {
      type: 'token_usage_record',
      ordinal: 2,
      timestamp: '2026-10-24T00:00:00Z',
      payload: { thread_id: 'thread', usage, thread_token_usage: usage }
    }
    const rows = parse('codex', [
      { type: 'session_meta', payload: { id: 'thread', cwd: '/project' } },
      {
        type: 'event_msg',
        payload: {
          type: 'token_count',
          info: { last_token_usage: usage, total_token_usage: usage }
        }
      },
      event,
      event
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0].tokens.total).toBe(120)
    expect(rows[0].project).toBe('/project')
  })
  it('Codex 旧累计事件重复不加两次，累计重置后有时间身份', () => {
    const event = (time: string, total: number) => ({
      type: 'event_msg',
      timestamp: time,
      payload: {
        type: 'token_count',
        info: { last_token_usage: usage, total_token_usage: { ...usage, total_tokens: total } }
      }
    })
    expect(
      parse('codex', [
        event('2026-01-01', 120),
        event('2026-01-01', 120),
        event('2026-01-02', 240),
        event('2026-01-03', 120)
      ])
    ).toHaveLength(3)
  })
  it('无法识别归属的继承历史不计成新消耗', () => {
    expect(
      parse('codex', [
        { type: 'session_meta', payload: { id: 'fork', history_base: { thread_id: 'parent' } } },
        { type: 'event_msg', payload: { type: 'token_count', info: { last_token_usage: usage } } }
      ])
    ).toHaveLength(0)
  })
  it('Claude 同一消息的流式重复仅保留最终 usage，正文不在结果中', () => {
    const a = {
      type: 'assistant',
      sessionId: 's',
      message: {
        id: 'msg',
        model: 'fixture',
        usage: { input_tokens: 10, output_tokens: 2 },
        content: 'PRIVATE_SENTINEL'
      }
    }
    const b = { ...a, message: { ...a.message, usage: { input_tokens: 10, output_tokens: 5 } } }
    const rows = parse('claude', [a, b])
    expect(rows).toHaveLength(1)
    expect(rows[0].tokens.total).toBe(15)
    expect(JSON.stringify(rows)).not.toContain('PRIVATE_SENTINEL')
  })
  it('Kimi 新版仅计 usage.record，忽略计数和轮次汇总', () => {
    const usage = { inputOther: 2, output: 3, inputCacheRead: 10, inputCacheCreation: 1 }
    const rows = parse('kimi', [
      { type: 'metadata', protocol_version: '1.5' },
      { type: 'usage.record', usageScope: 'turn', usage },
      { type: 'token_counting.turn_recorded', usage }
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0].tokens.total).toBe(16)
  })
  it('Kimi 1.1 按 message_id 去重，未知协议不乱读', () => {
    const r = {
      timestamp: 100,
      message: {
        payload: {
          message_id: 'm',
          token_usage: { input_other: 1, output: 2, input_cache_read: 3, input_cache_creation: 4 }
        }
      }
    }
    expect(
      parse('kimi', [{ type: 'metadata', protocol_version: '1.1' }, r, r])[0].tokens.total
    ).toBe(10)
    expect(parse('kimi', [{ type: 'metadata', protocol_version: '99' }, r])).toHaveLength(0)
  })
  it('Pi 聚合包含操作时只计操作，重复操作去重', () => {
    const op = {
      operationId: 'op',
      inputTokens: 2,
      outputTokens: 3,
      cacheReadTokens: 4,
      cacheWriteTokens: 1
    }
    const rows = parse('pi', [
      { type: 'session', id: 's' },
      { id: 'm', role: 'assistant', meta: { usage: { operations: [op, op], totalTokens: 10 } } }
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0].tokens.total).toBe(10)
  })
  it('Pi 聚合缺少部分操作明细时，只补原生总量差值且不伪造调用时间', () => {
    const rows = parse('pi', [
      { type: 'session', id: 's' },
      {
        id: 'm',
        role: 'assistant',
        meta: {
          usage: {
            totalTokens: 30,
            operations: [{ operationId: 'op', inputTokens: 10, outputTokens: 5, totalTokens: 15 }]
          }
        }
      }
    ])
    expect(rows).toHaveLength(2)
    expect(rows.find((r) => r.id.startsWith('aggregate-gap'))).toMatchObject({
      time: null,
      partial: true,
      requests: null,
      tokens: { total: 15, input: null }
    })
  })
  it('WorkBuddy 缓存归入输入，工具事件没有 usage 时不算请求', () => {
    const rows = parse('workbuddy', [
      {
        type: 'assistant',
        id: 'm',
        sessionId: 's',
        providerData: {
          usage: {
            inputTokens: 100,
            outputTokens: 20,
            inputTokensDetails: [{ cached_tokens: 80 }],
            outputTokensDetails: [{ reasoning_tokens: 5 }],
            totalTokens: 120
          }
        }
      },
      { type: 'function_call', id: 'tool' }
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0].tokens).toMatchObject({ input: 20, cacheRead: 80, reasoning: 5, total: 120 })
    expect(rows[0].partial).toBe(false)
  })
  it('DSH 丢弃继承段，usage 快照只计一次，重试单独计', () => {
    const usage = { inputTokens: 2, outputTokens: 3, cacheReadTokens: 4 }
    const rows = parse('dsh', [
      { type: 'session', version: 4, id: 's', isSeeded: true },
      { type: 'assistant/message', seq: 1, data: { turn: 0, step: 0, usage } },
      { type: 'session/end-seed', seq: 2, data: { inherited: true } },
      {
        type: 'assistant/chunk',
        seq: 3,
        data: { turn: 1, step: 0, chunk: { type: 'usage', usage } }
      },
      { type: 'assistant/message', seq: 4, data: { turn: 1, step: 0, usage } },
      { type: 'llm/retry-started', seq: 5, data: { turn: 1, step: 0 } },
      { type: 'assistant/message', seq: 6, data: { turn: 1, step: 0, usage } }
    ])
    expect(rows).toHaveLength(2)
    expect(rows.map((r) => r.tokens.total)).toEqual([9, 9])
  })
  it('Gemini journal 替换 / rewind 不保留重复消息', () => {
    const tokens = { input: 100, output: 10, cached: 50, thoughts: 5, total: 115 }
    const rows = parse('gemini', [
      { sessionId: 's' },
      { id: 'a', type: 'gemini', tokens },
      { id: 'b', type: 'gemini', tokens },
      { $rewindTo: 'b' },
      { id: 'a', type: 'gemini', tokens: { ...tokens, total: 120 } }
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0].tokens.total).toBe(120)
  })
})
