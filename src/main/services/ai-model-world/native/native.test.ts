import { zipSync, strToU8 } from 'fflate'
import { describe, expect, it, vi } from 'vitest'

import { buildNativeSnapshot } from './build'
import { fetchEpoch } from './epoch'
import { collectNativeSnapshot } from './index'
import { fetchModelsDev } from './models-dev'
import type { ModelsDevData } from './models-dev'
import type { FetchLike } from '../../github-trending/fetch'

function response(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 })
}

describe('原生 AI 数据源', () => {
  it('合并 models.dev 事实表与 provider 报价，优先厂商自己的价格', async () => {
    const fetchImpl = vi.fn(async (input: string) => {
      if (input.endsWith('/models.json'))
        return response({
          'acme/fast': {
            id: 'acme/fast',
            name: 'Fast',
            release_date: '2026-01-01',
            modalities: { input: ['text'], output: ['text'] },
            limit: { context: 1000, output: 100 },
            open_weights: true,
            license: 'MIT'
          }
        })
      return response({
        reseller: {
          id: 'reseller',
          name: 'Reseller',
          models: {
            fast: {
              id: 'fast',
              canonical_model_id: 'acme/fast',
              cost: { input: 5, output: 10 }
            }
          }
        },
        acme: {
          id: 'acme',
          name: 'Acme',
          models: {
            fast: {
              id: 'fast',
              canonical_model_id: 'acme/fast',
              cost: { input: 1, output: 2, cache_read: 0.1 },
              limit: { context: 2000, output: 200 }
            }
          }
        }
      })
    })
    const data = await fetchModelsDev(fetchImpl as unknown as FetchLike)
    expect(data.records).toHaveLength(1)
    expect(data.records[0]).toMatchObject({
      id: 'acme/fast',
      vendorId: 'acme',
      providerName: 'Acme',
      contextWindow: 1000,
      pricing: { inputPerMTok: 1, outputPerMTok: 2, cachedInputPerMTok: 0.1 },
      openWeights: true
    })
  })

  it('解压 Epoch zip，解析 ECI、核心评测与编程赛制', async () => {
    const zip = zipSync({
      'epoch_capabilities_index/eci_scores.csv': strToU8(
        'Model,Display name,eci,date,Organization,Country (of organization),Accessibility group\n' +
          'Fast,Fast,120,2026-01-01,Acme,United States of America,Closed weights\n'
      ),
      'swe_bench_verified.csv': strToU8(
        'Model version,mean_score,Best score (across scorers),Release date,Organization,Country\n' +
          'fast_max,0.75,0.75,2026-01-01,Acme,United States of America\n'
      ),
      'terminalbench_external.csv': strToU8(
        'Model version,Accuracy mean,Release date,Organization,Country,Source Link\n' +
          'fast,0.6,2026-01-01,Acme,United States of America,https://example.com/terminal\n'
      ),
      'aider_polyglot_external.csv': strToU8(
        'Model version,Percent correct,Release date,Organization,Country\n' +
          'fast,80,2026-01-01,Acme,United States of America\n'
      ),
      'live_bench_external.csv': strToU8(
        'Model version,Coding average,Release date,Organization,Country\n' +
          'fast,70,2026-01-01,Acme,United States of America\n'
      )
    })
    const fetchImpl = vi.fn(async () => new Response(zip, { status: 200 }))
    const data = await fetchEpoch(fetchImpl as unknown as FetchLike)
    const fast = data.models.find((model) => model.key === 'fast')
    expect(fast?.eci).toBe(120)
    expect(fast?.scores.map((score) => score.league)).toEqual(
      expect.arrayContaining([
        'eci',
        'swe_bench_verified',
        'terminal_bench',
        'aider_polyglot',
        'livebench_coding'
      ])
    )
    expect(fast?.coding.map((score) => score.league)).toEqual(
      expect.arrayContaining([
        'swe_bench_verified',
        'terminal_bench',
        'aider_polyglot',
        'livebench_coding'
      ])
    )
    expect(fast?.scores.find((score) => score.league === 'swe_bench_verified')?.score).toBe(75)
  })

  it('把 Epoch 成绩合并到同名模型，并保留无 models.dev 记录的评测模型', () => {
    const modelsDev: ModelsDevData = {
      providerNames: new Map([['acme', 'Acme']]),
      records: [
        {
          id: 'acme/fast',
          name: 'Fast',
          vendorId: 'acme',
          providerName: 'Acme',
          releaseDate: '2026-01-01',
          knowledgeCutoff: null,
          contextWindow: 1000,
          maxOutput: 100,
          pricing: { inputPerMTok: 1, outputPerMTok: 2, cachedInputPerMTok: null },
          modalities: { input: ['text'], output: ['text'] },
          capabilities: {
            toolCall: null,
            reasoning: null,
            structuredOutput: null,
            promptCaching: null
          },
          openWeights: true,
          license: 'MIT'
        }
      ]
    }
    const snapshot = buildNativeSnapshot({
      now: new Date('2026-06-01T00:00:00.000Z'),
      modelsDev,
      epoch: {
        models: [
          {
            key: 'fast',
            name: 'Fast',
            organization: 'Acme',
            country: 'United States of America',
            releaseDate: '2026-01-02',
            eci: 120,
            openWeights: null,
            scores: [
              {
                league: 'eci',
                score: 120,
                unit: 'index',
                attribution: 'third-party',
                source: 'epoch.ai',
                sourceUrl: null
              }
            ],
            coding: []
          },
          {
            key: 'unmatched',
            name: 'Unmatched',
            organization: 'DeepSeek',
            country: 'China',
            releaseDate: '2026-02-02',
            eci: 90,
            openWeights: true,
            scores: [],
            coding: []
          }
        ]
      }
    })

    expect(snapshot.models).toHaveLength(2)
    expect(snapshot.models.find((model) => model.id === 'acme/fast')).toMatchObject({
      benchmarks: { eci: 120 },
      releaseDate: '2026-01-02'
    })
    expect(snapshot.models.find((model) => model.name === 'Unmatched')).toMatchObject({
      vendorId: 'deepseek',
      openWeights: true
    })
    expect(snapshot.vendors.find((vendor) => vendor.id === 'deepseek')?.continent).toBe('east')
    expect(snapshot.sources['models.dev']?.ok).toBe(true)
  })

  it('Epoch 失败时保留 models.dev 模型并标记来源异常', async () => {
    const fetchImpl = vi.fn(async (input: string) => {
      if (input.endsWith('/models.json'))
        return response({
          'acme/fast': { id: 'acme/fast', name: 'Fast', release_date: '2026-01-01' }
        })
      if (input.endsWith('/api.json'))
        return response({ acme: { id: 'acme', name: 'Acme', models: {} } })
      throw new Error('synthetic-epoch-down')
    })
    const snapshot = await collectNativeSnapshot(fetchImpl as unknown as FetchLike, new Date())
    expect(snapshot.models).toHaveLength(1)
    expect(snapshot.sources['epoch.ai']).toMatchObject({ ok: false })
  })
})
