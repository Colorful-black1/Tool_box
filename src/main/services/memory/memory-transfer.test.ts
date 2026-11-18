import { describe, expect, it } from 'vitest'

import { parseMemoryExport, serializeMemoryExport } from './memory-transfer'
import type { MemoryItemView } from '../../../shared/types'

function item(overrides: Partial<MemoryItemView> = {}): MemoryItemView {
  return {
    id: 'm1',
    kind: 'preference',
    title: '先给结论',
    body: '回答先给结论。',
    tags: ['风格'],
    scope: 'global',
    confidence: 0.9,
    status: 'active',
    pinned: true,
    sourceConversationId: 'c1',
    sourceMessageId: 'msg1',
    sourceExcerpt: '以后都先给结论',
    createdAtMs: 1,
    updatedAtMs: 2,
    lastUsedAtMs: null,
    expiresAtMs: null,
    ...overrides
  }
}

describe('记忆导出', () => {
  it('JSON 往返保留正文、状态、置信度、置顶与到期时间，不导出来源 id', () => {
    const text = serializeMemoryExport(
      [item(), item({ id: 'm2', kind: 'episodic', status: 'pending', expiresAtMs: 123 })],
      'json'
    )
    const parsed = parseMemoryExport(text)

    expect(parsed).toHaveLength(2)
    expect(parsed[0]).toMatchObject({
      title: '先给结论',
      status: 'active',
      pinned: true,
      confidence: 0.9,
      tags: ['风格']
    })
    expect(parsed[1]).toMatchObject({ kind: 'episodic', status: 'pending', expiresAtMs: 123 })
    expect(text).not.toContain('c1')
    expect(text).not.toContain('msg1')
  })

  it('Markdown 可读但不接受导入', () => {
    const text = serializeMemoryExport([item()], 'markdown')
    expect(text).toContain('# 助手长期记忆')
    expect(text).toContain('## 偏好')
    expect(text).toContain('### 先给结论')
    expect(() => parseMemoryExport(text)).toThrow('Markdown 导出仅供阅读')
  })

  it('坏 JSON、版本不符与缺列表都拒绝', () => {
    expect(() => parseMemoryExport('')).toThrow('导入文件为空')
    expect(() => parseMemoryExport('{bad')).toThrow('不是有效的 JSON')
    expect(() => parseMemoryExport(JSON.stringify({ version: 2, items: [] }))).toThrow(
      '版本不受支持'
    )
    expect(() => parseMemoryExport(JSON.stringify({ version: 1 }))).toThrow('缺少记忆列表')
  })

  it('单条非法项跳过，不因一条坏数据拒绝整个文件', () => {
    const parsed = parseMemoryExport(
      JSON.stringify({
        version: 1,
        items: [
          { kind: 'preference', title: '有效', body: '正文', status: 'active' },
          { kind: 'unknown', title: '坏类型', body: '正文', status: 'active' },
          { kind: 'preference', title: '', body: '空标题', status: 'active' },
          { kind: 'preference', title: '坏状态', body: '正文', status: 'deleted' }
        ]
      })
    )
    expect(parsed).toHaveLength(1)
    expect(parsed[0].title).toBe('有效')
  })
})
