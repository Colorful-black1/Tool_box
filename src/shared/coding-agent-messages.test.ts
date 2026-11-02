import { describe, expect, it } from 'vitest'

import {
  mergeSessionMessages,
  takePageBefore,
  takeTailPage,
  trimOldestMessages
} from './coding-agent-messages'
import type { SessionMessage } from './coding-agent-messages'

function build(count: number, size = 10): SessionMessage[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `m${index + 1}`,
    role: index % 2 === 0 ? ('user' as const) : ('assistant' as const),
    content: 'x'.repeat(size),
    seq: index + 1
  }))
}

describe('takeTailPage', () => {
  it('按条数取最近一页，并标记还有更早内容', () => {
    const page = takeTailPage(build(100))
    expect(page.messages).toHaveLength(40)
    expect(page.messages[0].seq).toBe(61)
    expect(page.messages.at(-1)?.seq).toBe(100)
    expect(page.hasMore).toBe(true)
  })

  it('不足一页时全部返回且没有更早内容', () => {
    const page = takeTailPage(build(3))
    expect(page.messages.map((item) => item.seq)).toEqual([1, 2, 3])
    expect(page.hasMore).toBe(false)
  })

  it('字符预算先到时只返回最后一条，单条超长也不被挤掉', () => {
    const page = takeTailPage(build(5, 20_000))
    expect(page.messages).toHaveLength(1)
    expect(page.messages[0].seq).toBe(5)
    expect(page.hasMore).toBe(true)
  })

  it('空会话返回空页', () => {
    expect(takeTailPage([])).toEqual({ messages: [], hasMore: false })
  })
})

describe('takePageBefore', () => {
  it('取游标之前的一页并保留顺序', () => {
    const page = takePageBefore(build(100), 61)
    expect(page.messages.map((item) => item.seq)).toEqual(
      Array.from({ length: 40 }, (_, index) => index + 21)
    )
    expect(page.hasMore).toBe(true)
  })

  it('到达第一页时 hasMore 为 false', () => {
    const page = takePageBefore(build(100), 21)
    expect(page.messages).toHaveLength(20)
    expect(page.messages[0].seq).toBe(1)
    expect(page.hasMore).toBe(false)
  })

  it('游标已是第一条或不匹配时返回空页，避免重复渲染', () => {
    expect(takePageBefore(build(10), 1).messages).toHaveLength(0)
    expect(takePageBefore(build(10), 999).messages).toHaveLength(0)
  })
})

describe('mergeSessionMessages', () => {
  it('按 id 去重且保持先来后到', () => {
    const older = build(3)
    const newer = build(4).slice(2)
    const merged = mergeSessionMessages(older, newer)
    expect(merged.map((item) => item.id)).toEqual(['m1', 'm2', 'm3', 'm4'])
  })

  it('丢弃缺少 id 的脏数据', () => {
    const merged = mergeSessionMessages([], [{ id: '', role: 'user', content: 'x' }])
    expect(merged).toHaveLength(0)
  })
})

describe('trimOldestMessages', () => {
  it('超出条数预算时丢最旧并返回丢弃数', () => {
    const result = trimOldestMessages(build(10), 5, 1_000_000)
    expect(result.dropped).toBe(5)
    expect(result.messages.map((item) => item.seq)).toEqual([6, 7, 8, 9, 10])
  })

  it('超出字符预算时按需丢弃', () => {
    const result = trimOldestMessages(build(5, 100), 1_000, 250)
    expect(result.dropped).toBe(3)
    expect(result.messages).toHaveLength(2)
  })

  it('至少保留一条，未超预算时不改动', () => {
    const single = trimOldestMessages(build(1, 999), 1, 10)
    expect(single.dropped).toBe(0)
    expect(single.messages).toHaveLength(1)
    expect(trimOldestMessages(build(3), 100, 1_000_000).dropped).toBe(0)
  })
})
