import { describe, expect, it } from 'vitest'

import {
  firstLetterOf,
  normalizeTitle,
  toBookSummary,
  toConversation,
  todayKey
} from './store'

/**
 * MobileStore 的行映射与归一化是纯函数，可在 vitest 中覆盖。
 * SQL 语句本身由真机验收（expo-sqlite 是原生模块，vitest 里跑不起来）。
 */

describe('normalizeTitle', () => {
  it('压缩连续空白并去首尾', () => {
    expect(normalizeTitle('  书   名  ')).toBe('书 名')
  })

  it('空值回落默认值', () => {
    expect(normalizeTitle('   ')).toBe('未命名')
    expect(normalizeTitle('', '正文')).toBe('正文')
  })

  it('超长标题截断并加省略号', () => {
    const long = '书'.repeat(80)
    const result = normalizeTitle(long)
    expect(result.length).toBe(61)
    expect(result.endsWith('…')).toBe(true)
  })
})

describe('firstLetterOf', () => {
  it('ASCII 首字母大写', () => {
    expect(firstLetterOf('github')).toBe('G')
  })

  it('中文取拼音首字母', () => {
    expect(firstLetterOf('测试')).toBe('C')
    expect(firstLetterOf('阿里云')).toBe('A')
  })

  it('符号与空串回落 #', () => {
    expect(firstLetterOf('')).toBe('#')
    expect(firstLetterOf('   ')).toBe('#')
    expect(firstLetterOf('!!!')).toBe('#')
  })
})

describe('行映射', () => {
  const baseRow = {
    id: 'b1',
    title: '书',
    author: '',
    created_at_ms: 1,
    updated_at_ms: 2,
    cover_path: '',
    sort_index: 0,
    group_id: null,
    progress_percent: null,
    progress_updated: null
  }

  it('会话行的 message_count 缺省为 0', () => {
    expect(
      toConversation({ id: 'c1', title: '新对话', created_at_ms: 1, updated_at_ms: 2 })
    ).toEqual({
      id: 'c1',
      title: '新对话',
      createdAtMs: 1,
      updatedAtMs: 2,
      messageCount: 0
    })
  })

  it('书籍行把封面文件名转成 file:// URI，空值保持空', () => {
    expect(
      toBookSummary({ ...baseRow, progress_chapter: null }).coverPath
    ).toBe('')
    expect(
      toBookSummary({ ...baseRow, cover_path: 'cover_1.png', progress_chapter: null }).coverPath
    ).toBe('file://cover_1.png')
  })

  it('有阅读进度时映射为嵌套结构，chapter_count 缺省为 0', () => {
    const summary = toBookSummary({
      ...baseRow,
      author: '作者',
      progress_chapter: 2,
      progress_percent: 0.5,
      progress_updated: 99
    })

    expect(summary.chapterCount).toBe(0)
    expect(summary.progress).toEqual({ chapterIdx: 2, percent: 0.5, updatedAtMs: 99 })
  })
})

describe('todayKey', () => {
  it('输出 YYYY-MM-DD 且月份日期补零', () => {
    expect(todayKey()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})