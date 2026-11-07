import { describe, expect, it, vi } from 'vitest'

import { KbModelError, requestEmbeddings, requestRerank } from './kb-model-client'
import type { KbAiEndpointConfig } from '../settings/settings-service'

const config: KbAiEndpointConfig = {
  provider: 'custom',
  baseUrl: 'https://api.example.com/v1',
  apiKey: 'sk-test-secret',
  model: 'bge-m3'
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  })
}

function mockFetch(handler: (url: string, init?: RequestInit) => Response): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    return handler(String(input), init)
  }) as unknown as typeof fetch
}

describe('知识库模型客户端', () => {
  it('向量请求带鉴权与模型名，并按 index 还原顺序', async () => {
    const fetchImpl = mockFetch((_url, init) => {
      const body = JSON.parse(String(init?.body)) as { model: string; input: string[] }
      expect(body).toEqual({ model: 'bge-m3', input: ['甲', '乙'] })
      const headers = new Headers(init?.headers)
      expect(headers.get('Authorization')).toBe('Bearer sk-test-secret')
      return jsonResponse({
        data: [
          { index: 1, embedding: [0, 1] },
          { index: 0, embedding: [1, 0] }
        ]
      })
    })

    const vectors = await requestEmbeddings(config, ['甲', '乙'], { fetchImpl })
    expect(vectors.map((vector) => Array.from(vector))).toEqual([
      [1, 0],
      [0, 1]
    ])
  })

  it('向量条数或维度异常时给出可读错误', async () => {
    const missing = mockFetch(() => jsonResponse({ data: [{ embedding: [1, 0] }] }))
    await expect(requestEmbeddings(config, ['甲', '乙'], { fetchImpl: missing })).rejects.toThrow(
      '条数与请求不一致'
    )

    const mismatch = mockFetch(() =>
      jsonResponse({
        data: [
          { embedding: [1, 0] },
          { embedding: [1, 0, 0] }
        ]
      })
    )
    await expect(requestEmbeddings(config, ['甲', '乙'], { fetchImpl: mismatch })).rejects.toThrow(
      '维度不一致'
    )
  })

  it('HTTP 失败只暴露状态与可读提示，不泄露 Key', async () => {
    const fetchImpl = mockFetch(() => jsonResponse({ error: 'bad key' }, 401))
    const failure = requestEmbeddings(config, ['甲'], { fetchImpl })
    await expect(failure).rejects.toBeInstanceOf(KbModelError)
    await expect(failure).rejects.toThrow('请检查 API Key')
    await expect(failure).rejects.not.toThrow('sk-test-secret')
  })

  it('重排兼容 results / data 两种响应并回填缺失分数', async () => {
    const results = mockFetch(() =>
      jsonResponse({
        results: [
          { index: 0, relevance_score: 0.2 },
          { index: 1, relevance_score: 0.9 }
        ]
      })
    )
    expect(await requestRerank(config, '回滚', ['甲', '乙'], { fetchImpl: results })).toEqual([
      0.2, 0.9
    ])

    const data = mockFetch(() =>
      jsonResponse({ data: [{ index: 1, score: 0.7 }] })
    )
    const scores = await requestRerank(config, '回滚', ['甲', '乙'], { fetchImpl: data })
    expect(scores[1]).toBe(0.7)
    expect(scores[0]).toBe(Number.NEGATIVE_INFINITY)
  })

  it('重排没有有效分数时抛错，交给检索层保持融合排序', async () => {
    const fetchImpl = mockFetch(() => jsonResponse({ results: [] }))
    await expect(requestRerank(config, '回滚', ['甲'], { fetchImpl })).rejects.toThrow(
      '未返回有效分数'
    )
  })
})
