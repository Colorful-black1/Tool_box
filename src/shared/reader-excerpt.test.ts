import { describe, expect, it } from 'vitest'

import { buildReaderExcerpt, buildReaderQuestion } from './reader-excerpt'

const base = { bookTitle: '星轨', chapterTitle: '第一章 夜航', chapterIdx: 0 }

describe('buildReaderExcerpt', () => {
  it('单段选区生成引用与来源', () => {
    expect(buildReaderExcerpt({ ...base, selectedText: '  他想起小时候。 \n' })).toEqual({
      title: '《星轨》· 第一章 夜航',
      content: '> 他想起小时候。\n\n—— 《星轨》· 第一章 夜航（第 1 章）'
    })
  })

  it('多段落之间保留引用分隔，丢弃空行', () => {
    const note = buildReaderExcerpt({
      ...base,
      chapterIdx: 2,
      selectedText: '第一段\n\n\n  第二段  \r\n第三段'
    })
    expect(note?.content).toBe(
      '> 第一段\n>\n> 第二段\n>\n> 第三段\n\n—— 《星轨》· 第一章 夜航（第 3 章）'
    )
  })

  it('书名缺失时只保留章节名', () => {
    expect(buildReaderExcerpt({ ...base, bookTitle: ' ', selectedText: '句子' })?.title).toBe(
      '第一章 夜航'
    )
  })

  it('书名与章节名都缺失时用章节序号兜底', () => {
    expect(
      buildReaderExcerpt({
        ...base,
        bookTitle: '',
        chapterTitle: ' ',
        chapterIdx: 4,
        selectedText: '句子'
      })
    ).toEqual({
      title: '第 5 章摘录',
      content: '> 句子\n\n—— 第 5 章'
    })
  })

  it('标题超过 60 字时截断并加省略号', () => {
    const title = buildReaderExcerpt({
      ...base,
      chapterTitle: '很长的章节标题'.repeat(20),
      selectedText: '句子'
    })?.title
    expect(title).toHaveLength(60)
    expect(title?.endsWith('…')).toBe(true)
  })

  it('空白选区返回 null', () => {
    expect(buildReaderExcerpt({ ...base, selectedText: ' \n\t\r\n ' })).toBeNull()
  })
})

describe('buildReaderQuestion', () => {
  it('问题在前，原文与来源在后', () => {
    expect(buildReaderQuestion({ ...base, selectedText: '第一段\n第二段' })).toBe(
      '请解释下面这段内容，并补充必要的背景：\n\n> 第一段\n>\n> 第二段\n\n—— 《星轨》· 第一章 夜航（第 1 章）'
    )
  })

  it('空白选区返回 null', () => {
    expect(buildReaderQuestion({ ...base, selectedText: ' \n ' })).toBeNull()
  })

  it('超过 4000 字时截断并加省略号', () => {
    const question = buildReaderQuestion({ ...base, selectedText: '字'.repeat(5000) })
    expect(question).toHaveLength(4001)
    expect(question?.endsWith('…')).toBe(true)
  })
})
