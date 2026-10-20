import { describe, expect, it } from 'vitest'

import type { ChatMessage } from './types'
import { trimHistory } from './history'

function user(id: string, content: string): ChatMessage {
  return { id, conversationId: 'c1', role: 'user', content, createdAtMs: 1 }
}

function assistant(id: string, content: string): ChatMessage {
  return { id, conversationId: 'c1', role: 'assistant', content, createdAtMs: 2 }
}

describe('trimHistory', () => {
  it('空历史原样返回', () => {
    expect(trimHistory([], 100)).toEqual({ kept: [], dropped: 0 })
  })

  it('预算充足时全部保留', () => {
    const messages = [user('u1', '问题'), assistant('a1', '回答')]
    expect(trimHistory(messages, 1000)).toEqual({ kept: messages, dropped: 0 })
  })

  it('超预算时从最早的轮次开始丢，且保留连续的一段', () => {
    const messages = [
      user('u1', '一'.repeat(50)),
      assistant('a1', '二'.repeat(50)),
      user('u2', '三'.repeat(50)),
      assistant('a2', '四'.repeat(50))
    ]
    const result = trimHistory(messages, 120)

    // 只够留下最后两轮
    expect(result.kept.map((message) => message.id)).toEqual(['u2', 'a2'])
    expect(result.dropped).toBe(2)
  })

  it('不会只留半轮（user 与它的 assistant 同进同出）', () => {
    const messages = [
      user('u1', '一'.repeat(50)),
      assistant('a1', '二'.repeat(50)),
      user('u2', '三'.repeat(50)),
      assistant('a2', '四'.repeat(50))
    ]
    const result = trimHistory(messages, 60)
    const roles = result.kept.map((message) => message.role)
    expect(roles).toEqual(['user', 'assistant'])
  })

  it('最新一轮即使超预算也一定保留', () => {
    const messages = [user('u1', '短'), assistant('a1', '短'), user('u2', '长'.repeat(500))]
    const result = trimHistory(messages, 10)
    expect(result.kept.map((message) => message.id)).toEqual(['u2'])
    expect(result.dropped).toBe(2)
  })

  it('没有 assistant 回复的最后一轮（刚发出）也保留', () => {
    const messages = [user('u1', '一'.repeat(50)), assistant('a1', '二'.repeat(50)), user('u2', '新问题')]
    const result = trimHistory(messages, 10)
    expect(result.kept.map((message) => message.id)).toEqual(['u2'])
  })
})
