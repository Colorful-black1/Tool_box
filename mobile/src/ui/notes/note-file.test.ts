import { describe, expect, it } from 'vitest'

import { noteTitleFromFileName } from './note-file'

describe('noteTitleFromFileName', () => {
  it('去掉 Markdown 扩展名', () => {
    expect(noteTitleFromFileName('读书笔记.md')).toBe('读书笔记')
    expect(noteTitleFromFileName('读书笔记.MARKDOWN')).toBe('读书笔记')
    expect(noteTitleFromFileName('随手记.txt')).toBe('随手记')
  })

  it('没有扩展名时原样返回', () => {
    expect(noteTitleFromFileName('会议纪要')).toBe('会议纪要')
  })

  it('空名返回空串', () => {
    expect(noteTitleFromFileName('   ')).toBe('')
  })

  it('名字中间的扩展名不会被误删', () => {
    expect(noteTitleFromFileName('a.md.b.md')).toBe('a.md.b')
  })
})
