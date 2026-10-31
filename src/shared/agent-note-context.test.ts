import { describe, expect, it } from 'vitest'

import { buildNoteContext } from './agent-note-context'

describe('buildNoteContext', () => {
  it('带标题时生成带来源的段落', () => {
    expect(buildNoteContext({ title: ' 部署步骤 ', content: '  先回滚，再检查。 ' })).toBe(
      '【记事本：部署步骤】\n先回滚，再检查。'
    )
  })

  it('没有标题时使用通用标记', () => {
    expect(buildNoteContext({ title: ' ', content: '句子' })).toBe('【记事本摘录】\n句子')
  })

  it('超长内容截断到 2000 字并标记', () => {
    const context = buildNoteContext({ title: '长文', content: 'a'.repeat(2100) })
    expect(context).toContain('a'.repeat(2000))
    expect(context).not.toContain('a'.repeat(2001))
    expect(context?.endsWith('（内容较长，已截断）')).toBe(true)
  })

  it('空内容返回 null', () => {
    expect(buildNoteContext({ title: '空', content: ' \n\t ' })).toBeNull()
  })
})
