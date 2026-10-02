import { describe, expect, it } from 'vitest'

import { normalizeChapterText, parseChapters } from './chapter-parser'

describe('parseChapters', () => {
  it('splits chapters by 第X章 headers', () => {
    const body = '星穹列车驶出最后一个跃迁点，舷窗外的星光忽然安静了下来。'
    const text = ['第一章 起点', body, '第二章 发展', body].join('\n')
    const chapters = parseChapters(text)

    expect(chapters).toHaveLength(2)
    expect(chapters[0].title).toContain('第一章')
    expect(chapters[0].title).toContain('起点')
    expect(chapters[1].title).toContain('第二章')
  })

  it('keeps leading text as 开篇', () => {
    const body = '从前有座山，山里有座庙，庙里有个老和尚在讲故事。'
    const text = ['楔子：很久以前', body, '第一章 开始', body].join('\n')
    const chapters = parseChapters(text)

    expect(chapters[0].title).toBe('开篇')
    expect(chapters[1].title).toContain('第一章')
  })

  it('falls back to a single chapter for short text without headers', () => {
    const text = '没有任何章节标题的一小段文字。'
    const chapters = parseChapters(text)

    expect(chapters).toHaveLength(1)
    expect(chapters[0].title).toBe('全文')
  })

  it('pseudo-splits long text without headers', () => {
    const text = '甲'.repeat(120_000)
    const chapters = parseChapters(text)

    expect(chapters.length).toBeGreaterThan(1)
    expect(chapters.every((c, i) => c.idx === i)).toBe(true)
  })

  it('returns an empty list for blank input', () => {
    expect(parseChapters('   \n  ')).toEqual([])
  })

  it('normalizes CRLF line endings', () => {
    const body = '正文内容需要足够长才不会触发过短章节合并逻辑。'
    const text = `第一章 甲\r\n${body}\r\n第二章 乙\r\n${body}`
    const chapters = parseChapters(text)

    expect(chapters).toHaveLength(2)
    expect(chapters[1].start).toBeGreaterThan(chapters[0].start)
  })

  // 回归：偏移是 parseChapters 内部归一后那份文本的下标。调用方必须用
  // normalizeChapterText 归一后再切片，否则 CRLF 文本每章正文整体错位。
  // 之前只断言了 start 的先后顺序，正好放过了这个 bug。
  it('CRLF 文本的区间能在归一后的文本上取到正确正文', () => {
    const bodyA = '他推开门，风从走廊尽头灌进来，卷起地上的旧报纸。'
    const bodyB = '雨下了整夜，屋檐的水线一直没有断过。'
    const normalized = normalizeChapterText(`第一章 起点\r\n${bodyA}\r\n\r\n第二章 转折\r\n${bodyB}`)
    const chapters = parseChapters(normalized)

    expect(chapters.map((chapter) => normalized.slice(chapter.start, chapter.end).trim())).toEqual([
      bodyA,
      bodyB
    ])
  })

  it('normalizeChapterText 幂等，且无 CRLF 时原样返回同一份字符串', () => {
    const once = normalizeChapterText('第一章 甲\r\n正文')
    expect(normalizeChapterText(once)).toBe(once)

    const lfOnly = '第一章 甲\n正文'
    // 全局字符串驻留下引用可能相同，这里只断言内容一致，不强行要求引用相等
    expect(normalizeChapterText(lfOnly)).toBe(lfOnly)
  })

  it('merges chapters whose body is too short into the previous one', () => {
    const long = '这是足够长的正文内容，确保不会被合并掉。'
    const text = ['第一章 甲', long, '第二章 乙', '短'].join('\n')
    const chapters = parseChapters(text)

    expect(chapters).toHaveLength(1)
    expect(chapters[0].title).toContain('第一章')
  })
})