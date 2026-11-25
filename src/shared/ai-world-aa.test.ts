import { describe, expect, it } from 'vitest'

import { buildAiWorldAaFrontier } from './ai-world-aa'
import type { AiWorldAaModel } from './ai-world-aa'

function model(
  id: string,
  costPerTask: number | null,
  intelligenceIndex: number | null,
  outputPricePerMTok = 10
): AiWorldAaModel {
  return {
    id,
    slug: id,
    name: id,
    creator: 'Example',
    releaseDate: '2026-11-01',
    intelligenceIndex,
    capabilityIndexes: {
      financeAndAccounting: null,
      strategyAndOps: null,
      legal: null,
      healthcareAndMedical: null,
      engineering: null,
      economics: null
    },
    costPerTask,
    inputPricePerMTok: 1,
    outputPricePerMTok,
    outputTokensPerSecond: null,
    timeToFirstTokenSeconds: null,
    timeToFirstAnswerTokenSeconds: null
  }
}

describe('Artificial Analysis 智能 × 成本前沿', () => {
  it('按成本升序保留刷新最高智能的点', () => {
    const result = buildAiWorldAaFrontier(
      [
        model('d', 4, 60),
        model('a', 1, 50),
        model('b', 2, 55),
        model('c', 3, 54),
        model('tie', 2, 55),
        model('no-cost', null, 99),
        model('no-index', 5, null),
        model('zero-cost', 0, 70)
      ],
      'cost'
    )
    expect(result.points).toHaveLength(5)
    expect(result.frontier.map((point) => point.model.id)).toEqual(['a', 'b', 'd'])
  })

  it('输出价格口径独立计算，不混用每任务成本', () => {
    const result = buildAiWorldAaFrontier(
      [
        model('a', 1, 50, 20),
        model('b', 2, 55, 5),
        model('c', 3, 60, 10)
      ],
      'price'
    )
    expect(result.frontier.map((point) => point.model.id)).toEqual(['b', 'c'])
  })
})
