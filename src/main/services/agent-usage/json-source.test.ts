import { describe, expect, it } from 'vitest'
import { parseUsageJson } from './json-source'

describe('统计 JSON 快照', () => {
  it('Grok 逐轮明细优先，不再加会话汇总', () => {
    const usage = {
      inputTokens: 100,
      outputTokens: 20,
      cachedReadTokens: 80,
      totalTokens: 120,
      endedAt: '2026-10-24T00:00:00Z'
    }
    const rows = parseUsageJson('grok', '/sessions/s/usage.json', {
      sessionId: 's',
      session: usage,
      turns: [
        { ...usage, turnNumber: 1 },
        { ...usage, turnNumber: 2 }
      ]
    })
    expect(rows).toHaveLength(2)
    expect(rows[0].tokens.input).toBe(20)
    expect(rows[0].tokens.total).toBe(120)
  })
  it('Grok 只有累计时不以 updatedAt 伪造调用时间', () => {
    const rows = parseUsageJson('grok', '/sessions/s/usage.json', {
      sessionId: 's',
      updatedAt: '2026-10-24',
      session: { inputTokens: 100, outputTokens: 20, cachedReadTokens: 0, totalTokens: 120 }
    })
    expect(rows[0].time).toBeNull()
    expect(rows[0].requests).toBeNull()
    expect(rows[0].partial).toBe(true)
  })
  it('Cline 只统计 metrics，不读取正文或重复加会话累计', () => {
    const rows = parseUsageJson('cline', '/sessions/s/s.messages.json', {
      sessionId: 's',
      messages: [
        { id: 'a', text: 'PRIVATE_SENTINEL' },
        {
          id: 'b',
          ts: 100,
          modelInfo: { id: 'fixture' },
          metrics: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 70, cacheWriteTokens: 10 }
        }
      ]
    })
    expect(rows).toHaveLength(1)
    expect(rows[0].tokens).toMatchObject({ input: 20, output: 20, total: 120 })
    expect(JSON.stringify(rows)).not.toContain('PRIVATE_SENTINEL')
  })
  it('Gemini JSON 历史与 journal 使用相同口径', () => {
    const rows = parseUsageJson('gemini', '/tmp/p/chats/a.json', {
      sessionId: 's',
      messages: [
        {
          id: 'a',
          type: 'gemini',
          tokens: { input: 100, output: 20, cached: 70, thoughts: 10, total: 130 }
        }
      ]
    })
    expect(rows[0].tokens).toMatchObject({ input: 30, output: 20, reasoning: 10, total: 130 })
  })
})
