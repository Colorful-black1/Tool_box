import { describe, expect, it } from 'vitest'

import { parseChapters } from './chapter-parser'

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

  it('merges chapters whose body is too short into the previous one', () => {
    const long = '这是足够长的正文内容，确保不会被合并掉。'
    const text = ['第一章 甲', long, '第二章 乙', '短'].join('\n')
    const chapters = parseChapters(text)

    expect(chapters).toHaveLength(1)
    expect(chapters[0].title).toContain('第一章')
  })
})