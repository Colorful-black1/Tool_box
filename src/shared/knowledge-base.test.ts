import { clipSegment, selectKbHits } from './knowledge-base'
import type { KbSearchHit } from './knowledge-base'

function hit(id: string, documentId: string, content: string, score = 0): KbSearchHit {
  return {
    chunkId: id,
    documentId,
    documentTitle: `文档 ${documentId}`,
    category: 'work',
    heading: '',
    ordinal: 0,
    charCount: content.length,
    content,
    startOffset: 0,
    score
  }
}

describe('知识库检索预算', () => {
  it('限制单文档占比，按原始顺序保留高分命中', () => {
    const hits = [
      ...Array.from({ length: 10 }, (_, index) => hit(`a-${index}`, 'a', '片段'.repeat(50))),
      ...Array.from({ length: 6 }, (_, index) => hit(`b-${index}`, 'b', '片段'.repeat(50)))
    ]

    const result = selectKbHits(hits, { maxChunks: 8, perDocument: 4, maxChars: 6000 })
    expect(result.hits.map((item) => item.chunkId)).toEqual([
      'a-0',
      'a-1',
      'a-2',
      'a-3',
      'b-0',
      'b-1',
      'b-2',
      'b-3'
    ])
    expect(result.dropped).toBe(8)
    expect(result.totalChars).toBe(8 * 100)
  })

  it('字符预算用尽时停止追加，不返回低分块', () => {
    const hits = [hit('1', 'a', '甲'.repeat(1200)), hit('2', 'b', '乙'.repeat(1200))]

    const result = selectKbHits(hits, { maxChunks: 8, maxChars: 2000 })
    expect(result.hits).toHaveLength(1)
    expect(result.totalChars).toBe(1200)
    expect(result.dropped).toBe(1)
  })

  it('超长片段按句末截断并标注省略', () => {
    const sentence = '这是完整的一句话。'
    const content = sentence.repeat(200)
    const clipped = clipSegment(content, 1200)

    expect(clipped.length).toBeLessThanOrEqual(1201)
    expect(clipped.endsWith('…')).toBe(true)
    expect(clipped).toBe(`${sentence.repeat(133)}…`)
  })

  it('没有句末标点时硬切', () => {
    expect(clipSegment('甲'.repeat(2000), 100)).toBe(`${'甲'.repeat(100)}…`)
    expect(clipSegment('短文本', 100)).toBe('短文本')
  })
})
