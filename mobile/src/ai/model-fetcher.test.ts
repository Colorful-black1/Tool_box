import { describe, expect, it } from 'vitest'

import { fetchModelIds, fetchModels } from './model-fetcher'
import type { FetchLike } from './stream-chat'
import type { AiSettingsService } from './ai-settings'

function jsonResponse(payload: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(payload),
    text: () => Promise.resolve(JSON.stringify(payload))
  } as unknown as Response
}

function errorResponse(status: number, payload: unknown): Response {
  return {
    ok: false,
    status,
    text: () => Promise.resolve(JSON.stringify(payload))
  } as unknown as Response
}

const ok = (payload: unknown): FetchLike => () => Promise.resolve(jsonResponse(payload))

function settingsWith(apiKey: string): AiSettingsService {
  return { apiKeyForProfile: () => Promise.resolve(apiKey) } as unknown as AiSettingsService
}

describe('fetchModelIds 解析', () => {
  it('OpenAI 结构 { data: [{ id }] }', async () => {
    const models = await fetchModelIds({
      baseUrl: 'https://api.deepseek.com/v1',
      apiKey: 'sk-1',
      provider: 'deepseek',
      fetchImpl: ok({ data: [{ id: 'b' }, { id: 'a' }, { id: 'a' }] })
    })
    expect(models).toEqual(['a', 'b'])
  })

  it('Gemini 结构 { models: [{ name }] } 去 models/ 前缀', async () => {
    const models = await fetchModelIds({
      baseUrl: 'https://x/v1',
      apiKey: 'sk-1',
      provider: 'custom',
      fetchImpl: ok({ models: [{ name: 'models/gemini-2.5' }] })
    })
    expect(models).toEqual(['gemini-2.5'])
  })

  it('裸数组', async () => {
    const models = await fetchModelIds({
      baseUrl: 'https://x/v1',
      apiKey: 'sk-1',
      provider: 'custom',
      fetchImpl: ok(['m2', 'm1'])
    })
    expect(models).toEqual(['m1', 'm2'])
  })

  it('空模型列表报错', async () => {
    await expect(
      fetchModelIds({
        baseUrl: 'https://x/v1',
        apiKey: 'sk-1',
        provider: 'custom',
        fetchImpl: ok({ data: [] })
      })
    ).rejects.toThrow(/没有返回可用模型/)
  })
})

describe('fetchModelIds 错误处理', () => {
  it('401 映射为 Key 无效', async () => {
    await expect(
      fetchModelIds({
        baseUrl: 'https://x/v1',
        apiKey: 'sk-1',
        provider: 'custom',
        fetchImpl: () => Promise.resolve(errorResponse(401, { error: { message: 'invalid api key' } }))
      })
    ).rejects.toThrow(/API Key 无效/)
  })

  it('403 映射为无权限', async () => {
    await expect(
      fetchModelIds({
        baseUrl: 'https://x/v1',
        apiKey: 'sk-1',
        provider: 'custom',
        fetchImpl: () => Promise.resolve(errorResponse(403, { error: { message: 'forbidden' } }))
      })
    ).rejects.toThrow(/没有访问该模型的权限/)
  })

  it('RN 网络异常映射为可读提示', async () => {
    await expect(
      fetchModelIds({
        baseUrl: 'https://x/v1',
        apiKey: 'sk-1',
        provider: 'custom',
        fetchImpl: () => Promise.reject(new Error('Network request failed'))
      })
    ).rejects.toThrow(/无法连接 AI 服务/)
  })
})

describe('fetchModels 降级', () => {
  it('远端成功时 source 为 remote', async () => {
    const result = await fetchModels(
      settingsWith('sk-1'),
      { provider: 'deepseek', baseUrl: 'https://api.deepseek.com/v1' },
      ok({ data: [{ id: 'deepseek-v4-pro' }] })
    )
    expect(result.source).toBe('remote')
    expect(result.models).toEqual(['deepseek-v4-pro'])
    expect(result.message).toBeUndefined()
  })

  // 关键回归：远端挂了不能让用户面对空下拉框
  it('远端失败降级为内置推荐列表', async () => {
    const result = await fetchModels(
      settingsWith('sk-1'),
      { provider: 'deepseek', baseUrl: 'https://api.deepseek.com/v1' },
      () => Promise.reject(new Error('Network request failed'))
    )
    expect(result.source).toBe('preset')
    expect(result.models.length).toBeGreaterThan(0)
    expect(result.message).toMatch(/内置推荐模型/)
  })

  // custom 没有预设列表，失败必须直接报错而不是给空列表
  it('自定义供应商失败时直接抛错', async () => {
    await expect(
      fetchModels(
        settingsWith('sk-1'),
        { provider: 'custom', baseUrl: 'https://x/v1' },
        () => Promise.reject(new Error('Network request failed'))
      )
    ).rejects.toThrow(/无法连接 AI 服务/)
  })
})

describe('fetchModels Key 回落', () => {
  it('没填 Key 时回落到已保存的 Key', async () => {
    let usedKey = ''
    const fetchImpl: FetchLike = (_url, init) => {
      usedKey = String((init?.headers as Record<string, string>)?.['Authorization'] ?? '')
      return Promise.resolve(jsonResponse({ data: [{ id: 'm' }] }))
    }

    await fetchModels(settingsWith('sk-saved'), { provider: 'deepseek', baseUrl: 'https://x/v1' }, fetchImpl)
    expect(usedKey).toBe('Bearer sk-saved')
  })

  it('输入的 Key 优先于已保存的', async () => {
    let usedKey = ''
    const fetchImpl: FetchLike = (_url, init) => {
      usedKey = String((init?.headers as Record<string, string>)?.['Authorization'] ?? '')
      return Promise.resolve(jsonResponse({ data: [{ id: 'm' }] }))
    }

    await fetchModels(
      settingsWith('sk-saved'),
      { provider: 'deepseek', baseUrl: 'https://x/v1', apiKey: 'sk-typed' },
      fetchImpl
    )
    expect(usedKey).toBe('Bearer sk-typed')
  })

  it('两处都没有 Key 时报错', async () => {
    await expect(
      fetchModels(settingsWith(''), { provider: 'deepseek', baseUrl: 'https://x/v1' }, ok({ data: [] }))
    ).rejects.toThrow(/请先填写或保存 API Key/)
  })

  it('接口地址为空报错', async () => {
    await expect(
      fetchModels(settingsWith('sk-1'), { provider: 'deepseek', baseUrl: '  ' }, ok({}))
    ).rejects.toThrow(/请先填写接口地址/)
  })
})