import { describe, expect, it } from 'vitest'

import { mergeNotes } from './notes-merge'

describe('mergeNotes', () => {
  it('按顺序保留各自标题，并用分隔线隔开', () => {
    expect(
      mergeNotes([
        { title: '周一摘录', content: '> 一句话\n\n—— 《星轨》' },
        { title: '周三摘录', content: '> 另一句' }
      ])
    ).toEqual({
      title: '周一摘录 等 2 条',
      content: '## 周一摘录\n\n> 一句话\n\n—— 《星轨》\n\n---\n\n## 周三摘录\n\n> 另一句'
    })
  })

  it('空标题用「（无标题）」占位，标题回退到「合并笔记」', () => {
    expect(
      mergeNotes([
        { title: ' ', content: '正文一' },
        { title: '', content: '正文二' }
      ])
    ).toEqual({
      title: '合并笔记 等 2 条',
      content: '## （无标题）\n\n正文一\n\n---\n\n## （无标题）\n\n正文二'
    })
  })

  it('少于两条可合并的笔记返回 null', () => {
    expect(mergeNotes([{ title: '一条', content: '正文' }])).toBeNull()
    expect(
      mergeNotes([
        { title: '一条', content: '正文' },
        { title: '  ', content: ' ' }
      ])
    ).toBeNull()
  })

  it('标题超过 60 字时截断并加省略号', () => {
    const merged = mergeNotes([
      { title: '很长的标题'.repeat(20), content: 'a' },
      { title: '第二条', content: 'b' }
    ])
    expect(merged?.title).toHaveLength(60)
    expect(merged?.title.endsWith('…')).toBe(true)
  })
})
