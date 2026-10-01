import { describe, expect, it } from 'vitest'

import { locate, paginate, searchChapters } from './paginator'

describe('paginate', () => {
  it('returns a single page when content fits', () => {
    const result = paginate(500, 800)
    expect(result.pageCount).toBe(1)
    expect(result.pageOffsets).toEqual([0])
  })

  it('splits content into pages by viewport height', () => {
    const result = paginate(2500, 800)
    expect(result.pageCount).toBe(4)
    expect(result.pageOffsets[0]).toBe(0)
    expect(result.pageOffsets[result.pageOffsets.length - 1]).toBeLessThan(1)
  })

  it('handles degenerate measurements', () => {
    expect(paginate(0, 800).pageCount).toBe(1)
    expect(paginate(1000, 0).pageCount).toBe(1)
  })
})

describe('locate', () => {
  const offsets = [0, 0.25, 0.5, 0.75]

  it('finds the page containing a ratio', () => {
    expect(locate(offsets, 0)).toBe(0)
    expect(locate(offsets, 0.24)).toBe(0)
    expect(locate(offsets, 0.26)).toBe(1)
    expect(locate(offsets, 0.9)).toBe(3)
  })

  it('clamps out-of-range ratios', () => {
    expect(locate(offsets, -1)).toBe(0)
    expect(locate(offsets, 2)).toBe(3)
  })
})

describe('searchChapters', () => {
  const chapters = [
    { idx: 0, title: '第一章', content: '星穹列车驶出跃迁点，星光洒落。' },
    { idx: 1, title: '第二章', content: '他说：愿此行，终抵群星。' }
  ]

  it('finds case-insensitive matches with context', () => {
    const { hits } = searchChapters(chapters, '星穹')
    expect(hits).toHaveLength(1)
    expect(hits[0].chapterIdx).toBe(0)
    expect(hits[0].match).toBe('星穹')
    expect(hits[0].before.length).toBeLessThanOrEqual(20)
  })

  it('returns nothing for an empty query', () => {
    expect(searchChapters(chapters, '   ').hits).toHaveLength(0)
  })

  it('respects the result cap', () => {
    const long = [{ idx: 0, title: '重复', content: 'x'.repeat(1000) }]
    const { hits, truncated } = searchChapters(long, 'x', 10)
    expect(hits).toHaveLength(10)
    expect(truncated).toBe(true)
  })

  it('computes a ratio for jumping', () => {
    const { hits } = searchChapters(chapters, '终抵')
    expect(hits[0].chapterIdx).toBe(1)
    expect(hits[0].ratio).toBeGreaterThan(0)
    expect(hits[0].ratio).toBeLessThan(1)
  })
})