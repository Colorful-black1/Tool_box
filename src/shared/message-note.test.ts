import { describe, expect, it } from 'vitest'

import { buildMessageNote } from './message-note'

describe('buildMessageNote', () => {
  it('取首行作标题，正文保留并附来源', () => {
    const note = buildMessageNote({
      content: 'ABI 已重建，dev 可以启动。\n\n下一步跑 typecheck。',
      origin: 'Claude Code · 修复 ABI 构建'
    })
    expect(note).toEqual({
      title: 'ABI 已重建，dev 可以启动。',
      content:
        'ABI 已重建，dev 可以启动。\n\n下一步跑 typecheck。\n\n—— 来自 Claude Code · 修复 ABI 构建'
    })
  })

  it('剥离 Markdown 标记并跳过代码块起始行', () => {
    const note = buildMessageNote({
      content: '```ts\n## 结论：先跑 lint\n- 再跑 test\n```',
      origin: ''
    })
    expect(note?.title).toBe('结论：先跑 lint')
  })

  it('空内容或纯空白返回 null', () => {
    expect(buildMessageNote({ content: '   \n\n ', origin: '星轨对话' })).toBeNull()
  })

  it('首行过长时截断到 60 字并以省略号结尾', () => {
    const note = buildMessageNote({ content: '很长的结论'.repeat(20), origin: '' })
    expect(note?.title).toHaveLength(60)
    expect(note?.title.endsWith('…')).toBe(true)
  })

  it('正文超过 5000 字时截断并标注', () => {
    const note = buildMessageNote({ content: 'a'.repeat(6000), origin: '星轨对话' })
    expect(note?.content).toContain('（内容较长，已截断）')
    expect(note?.content.startsWith('a'.repeat(5000))).toBe(true)
  })

  it('来源缺失时标题回退到对话摘录', () => {
    const note = buildMessageNote({ content: '```\n```', origin: '' })
    expect(note?.title).toBe('对话摘录')
    expect(note?.content.endsWith('—— 来自')).toBe(false)
  })
})
