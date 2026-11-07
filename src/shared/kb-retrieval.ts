import { KB_RRF_K } from './knowledge-base'
import type { KbSearchHit } from './knowledge-base'

/** 余弦相似度；维度不一致视为 0（不同向量模型的块不能混算）。 */
export function cosineSimilarity(a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (a.length === 0 || a.length !== b.length) return 0
  let dot = 0
  let normA = 0
  let normB = 0
  for (let index = 0; index < a.length; index += 1) {
    const x = a[index]
    const y = b[index]
    dot += x * y
    normA += x * x
    normB += y * y
  }
  if (normA === 0 || normB === 0) return 0
  return dot / Math.sqrt(normA * normB)
}

export interface KbVectorCandidate {
  chunkId: string
  score: number
}

/**
 * 暴力余弦：只保留达到阈值的块，按分数倒序取前 limit 条。
 * 纯函数，主进程与单测共用；2 万块以内调用方直接全量传入。
 */
export function rankVectorCandidates(
  query: ArrayLike<number>,
  entries: ReadonlyArray<{ chunkId: string; vector: ArrayLike<number> }>,
  limit: number,
  minScore: number
): KbVectorCandidate[] {
  const scored: KbVectorCandidate[] = []
  for (const entry of entries) {
    const score = cosineSimilarity(query, entry.vector)
    if (score >= minScore) scored.push({ chunkId: entry.chunkId, score })
  }
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, Math.max(0, limit))
}

/**
 * 倒数排名融合：`score = Σ 1 / (k + rank)`，rank 从 1 开始。
 * 同一个块两路都命中时分数相加，元数据保留先出现的那份（关键词优先）。
 */
export function fuseKbHits(
  keyword: readonly KbSearchHit[],
  semantic: readonly KbSearchHit[],
  k = KB_RRF_K
): KbSearchHit[] {
  const fused = new Map<string, KbSearchHit>()
  const add = (hits: readonly KbSearchHit[]): void => {
    hits.forEach((hit, index) => {
      const score = 1 / (k + index + 1)
      const existing = fused.get(hit.chunkId)
      if (existing) {
        existing.score += score
        return
      }
      fused.set(hit.chunkId, { ...hit, score })
    })
  }
  add(keyword)
  add(semantic)
  return [...fused.values()].sort((a, b) => b.score - a.score)
}

/**
 * 重排分数回填：按重排分数倒序，缺失分数保持原顺序排在后面。
 * 纯函数，便于验证“失败时保持融合排序”的调用方逻辑。
 */
export function applyRerankScores(
  hits: readonly KbSearchHit[],
  scores: readonly number[]
): KbSearchHit[] {
  return hits
    .map((hit, index) => ({ hit, index, score: scores[index] ?? Number.NEGATIVE_INFINITY }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((item) => ({ ...item.hit, score: item.score }))
}
