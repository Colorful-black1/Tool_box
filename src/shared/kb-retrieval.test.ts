import type { KbSearchHit } from './knowledge-base'
import {
  applyRerankScores,
  cosineSimilarity,
  fuseKbHits,
  rankVectorCandidates
} from './kb-retrieval'

function hit(chunkId: string, content = chunkId): KbSearchHit {
  return {
    chunkId,
    documentId: 'doc',
    documentTitle: '资料',
    category: 'work',
    heading: '',
    ordinal: 0,
    charCount: content.length,
    content,
    startOffset: 0,
    score: 0
  }
}

describe('知识库语义检索基础函数', () => {
  it('余弦相似度覆盖同向、正交、反向与维度不一致', () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1)
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0)
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1)
    expect(cosineSimilarity([1, 0], [1, 0, 0])).toBe(0)
    expect(cosineSimilarity([0, 0], [1, 0])).toBe(0)
  })

  it('按阈值过滤并按相似度取前 N', () => {
    const ranked = rankVectorCandidates(
      [1, 0],
      [
        { chunkId: 'a', vector: [1, 0] },
        { chunkId: 'b', vector: [0.8, 0.6] },
        { chunkId: 'c', vector: [0, 1] }
      ],
      2,
      0.25
    )
    expect(ranked.map((item) => item.chunkId)).toEqual(['a', 'b'])
    expect(ranked[1].score).toBeCloseTo(0.8)
  })

  it('RRF 融合两路，重复块分数相加且关键词元数据优先', () => {
    const keyword = [hit('a'), hit('b')]
    const semantic = [hit('b', '语义版本'), hit('c')]
    const fused = fuseKbHits(keyword, semantic, 60)

    expect(fused.map((item) => item.chunkId)).toEqual(['b', 'a', 'c'])
    expect(fused[0].content).toBe('b')
    expect(fused[0].score).toBeCloseTo(1 / 62 + 1 / 61)
    expect(fused[1].score).toBeCloseTo(1 / 61)
    expect(fused[2].score).toBeCloseTo(1 / 62)
  })

  it('重排分数按倒序回填，缺失分数保持原有顺序', () => {
    const reranked = applyRerankScores([hit('a'), hit('b'), hit('c')], [0.2, 0.9])
    expect(reranked.map((item) => item.chunkId)).toEqual(['b', 'a', 'c'])
    expect(reranked[0].score).toBeCloseTo(0.9)
  })
})
