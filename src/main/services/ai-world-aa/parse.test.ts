import { describe, expect, it } from 'vitest'
import { parseAiWorldAaPage } from './parse'

const page = {
  tier: 'free',
  intelligence_index_version: 5,
  pagination: { page: 1, page_size: 200, total_pages: 2, has_more: true },
  data: [
    {
      id: 'model-1',
      name: 'GPT-6.2 Astra (Max)',
      slug: 'gpt-6-2-astra',
      release_date: '2026-11-17',
      model_creator: { id: 'creator-1', name: 'OpenAI' },
      evaluations: {
        artificial_analysis_intelligence_index: 62.4,
        artificial_analysis_finance_and_accounting_index: 61.2,
        artificial_analysis_strategy_and_ops_index: 63.8,
        artificial_analysis_legal_index: 59.4,
        artificial_analysis_healthcare_and_medical_index: 57.1,
        artificial_analysis_engineering_index: 66.3,
        artificial_analysis_economics_index: 60.5,
        artificial_analysis_coding_index: null
      },
      artificial_analysis_intelligence_index_cost: {
        total_cost: 3495.62,
        cost_per_task: { total_cost: 5.0093 }
      },
      pricing: {
        price_1m_input_tokens: 10,
        price_1m_output_tokens: 50,
        price_1m_cache_hit_tokens: 2
      },
      performance_v3: {
        mean_output_tokens_per_second: 62.36,
        mean_time_to_first_token_seconds: 3.45,
        mean_time_to_first_answer_token_seconds: 79.11
      }
    },
    {
      id: 'model-2',
      name: 'Mini Model',
      slug: 'mini-model',
      release_date: null,
      model_creator: { name: 'Example' },
      evaluations: {},
      pricing: {},
      performance_v3: null
    },
    { name: '缺少 ID 与 slug' }
  ]
}

describe('Artificial Analysis 免费档解析', () => {
  it('映射智能指数、六项能力指数、成本、价格与性能', () => {
    const result = parseAiWorldAaPage(page)
    expect(result.hasMore).toBe(true)
    expect(result.intelligenceIndexVersion).toBe(5)
    expect(result.models).toHaveLength(2)
    expect(result.models[0]).toMatchObject({
      id: 'model-1',
      slug: 'gpt-6-2-astra',
      name: 'GPT-6.2 Astra (Max)',
      creator: 'OpenAI',
      releaseDate: '2026-11-17',
      intelligenceIndex: 62.4,
      costPerTask: 5.0093,
      inputPricePerMTok: 10,
      outputPricePerMTok: 50,
      outputTokensPerSecond: 62.36,
      timeToFirstTokenSeconds: 3.45,
      timeToFirstAnswerTokenSeconds: 79.11
    })
    expect(result.models[0].capabilityIndexes).toEqual({
      financeAndAccounting: 61.2,
      strategyAndOps: 63.8,
      legal: 59.4,
      healthcareAndMedical: 57.1,
      engineering: 66.3,
      economics: 60.5
    })
  })

  it('缺失字段按 null 降级，不填 0', () => {
    const result = parseAiWorldAaPage(page)
    const model = result.models[1]
    expect(model.releaseDate).toBeNull()
    expect(model.intelligenceIndex).toBeNull()
    expect(model.costPerTask).toBeNull()
    expect(model.inputPricePerMTok).toBeNull()
    expect(model.outputTokensPerSecond).toBeNull()
    expect(model.capabilityIndexes.legal).toBeNull()
  })

  it('整页不是对象或缺少 data 时明确报错', () => {
    expect(() => parseAiWorldAaPage(null)).toThrow('不是对象')
    expect(() => parseAiWorldAaPage({ data: {} })).toThrow('缺少模型列表')
  })
})
