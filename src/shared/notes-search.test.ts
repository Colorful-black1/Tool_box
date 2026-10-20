import { describe, expect, it } from 'vitest'

import type { NoteView } from './types'
import { searchNotes } from './notes-search'

function note(partial: Partial<NoteView> & { id: string }): NoteView {
  return {
    title: '',
    content: '',
    createdAtMs: 0,
    updatedAtMs: 0,
    ...partial
  }
}

const notes: NoteView[] = [
  note({
    id: 'n1',
    title: '读书笔记',
    content: '第一段内容。第二段提到星轨列车。第三段结束。',
    updatedAtMs: 100
  }),
  note({
    id: 'n2',
    title: '待办',
    content: '给妈妈打电话',
    updatedAtMs: 200
  }),
  note({
    id: 'n3',
    title: '星轨计划',
    content: '关于星轨的记录',
    updatedAtMs: 300
  })
]

describe('searchNotes', () => {
  it('空关键词返回空数组', () => {
    expect(searchNotes(notes, '   ')).toEqual([])
  })

  it('能搜到正文里的内容并给出片段', () => {
    const hits = searchNotes(notes, '星轨列车')
    expect(hits).toHaveLength(1)
    expect(hits[0]).toMatchObject({ id: 'n1', matchedIn: 'content' })
    expect(hits[0]?.snippet).toContain('星轨列车')
  })

  it('标题命中排在正文命中之前', () => {
    const hits = searchNotes(notes, '星轨')
    expect(hits.map((hit) => hit.id)).toEqual(['n3', 'n1'])
    expect(hits[0]?.matchedIn).toBe('title')
  })

  it('大小写不敏感', () => {
    expect(searchNotes(notes, 'GIVE')).toHaveLength(0)
    expect(searchNotes(notes, '待办')).toHaveLength(1)
  })

  it('同类命中按更新时间倒序', () => {
    const hits = searchNotes(
      [
        note({ id: 'old', title: 'a', content: 'x', updatedAtMs: 1 }),
        note({ id: 'new', title: 'b', content: 'x', updatedAtMs: 9 })
      ],
      'x'
    )
    expect(hits.map((hit) => hit.id)).toEqual(['new', 'old'])
  })

  it('超出 limit 时截断', () => {
    expect(searchNotes(notes, '的', 1)).toHaveLength(1)
  })

  it('标题命中时给正文开头预览，没有正文则回退到标题', () => {
    const hits = searchNotes([note({ id: 'n4', title: '只有标题', content: '' })], '只有标题')
    expect(hits[0]?.snippet).toBe('只有标题')
  })
})
