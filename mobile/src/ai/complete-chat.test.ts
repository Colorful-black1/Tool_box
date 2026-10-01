import { describe, expect, it, vi } from 'vitest'

import { buildCompletionBody, completeChat } from './complete-chat'
import type { FetchLike } from './stream-chat'

const BASE = {
  baseUrl: 'https://api.example.com/v1',
  apiKey: 'sk-test',
  model: 'test-model',
  provider: 'custom' as const,
  sessionId: 'sess-1'
}

interface Call {
  url: string
  init: RequestInit | undefined
}

/** 造一个只返回一次固定 JSON 的 fetch，同时记录请求内容 */
function jsonFetch(payload: unknown, status = 200): { fetchImpl: FetchLike; calls: Call[] } {
  const calls: Call[] = []
  const fetchImpl: FetchLike = (url, init) => {
    calls.push({ url, init })
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      text: () => Promise.resolve(JSON.stringify(payload))
    } as unknown as Response)
  }
  return { fetchImpl, calls }
}

function textFetch(body: string, status = 200): { fetchImpl: FetchLike; calls: Call[] } {
  const calls: Call[] = []
  const fetchImpl: FetchLike = (url, init) => {
    calls.push({ url, init })
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      text: () => Promise.resolve(body)
    } as unknown as Response)
  }
  return { fetchImpl, calls }
}

function run(
  fetchImpl: FetchLike,
  overrides: Partial<Parameters<typeof completeChat>[0]> = {}
): Promise<string> {
  return completeChat({
    ...BASE,
    prompt: '识别这段文本',
    signal: new AbortController().signal,
    timeoutMs: 1000,
    fetchImpl,
    ...overrides
  })
}

describe('buildCompletionBody', () => {
  it('stream 为 false，并带上 system 与 user 两条消息', () => {
    const body = JSON.parse(
      buildCompletionBody({ model: 'm', system: 'S', prompt: 'P', temperature: 0.2 })
    )
    expect(body.stream).toBe(false)
    expect(body.messages).toEqual([
      { role: 'system', content: 'S' },
      { role: 'user', content: 'P' }
    ])
  })

  it('没有 system 时只发 user', () => {
    const body = JSON.parse(buildCompletionBody({ model: 'm', prompt: 'P', temperature: 0.2 }))
    expect(body.messages).toEqual([{ role: 'user', content: 'P' }])
  })
})

describe('completeChat', () => {
  it('取 choices[0].message.content', async () => {
    const { fetchImpl, calls } = jsonFetch({
      choices: [{ message: { role: 'assistant', content: '[{"title":"A"}]' } }]
    })
    await expect(run(fetchImpl)).resolves.toBe('[{"title":"A"}]')
    expect(calls[0]?.url).toBe('https://api.example.com/v1/chat/completions')
    expect(calls[0]?.init?.method).toBe('POST')
  })

  it('兼容 content 为 block 数组的形态', async () => {
    const { fetchImpl } = jsonFetch({
      choices: [{ message: { content: [{ text: '前半' }, { text: '后半' }] } }]
    })
    await expect(run(fetchImpl)).resolves.toBe('前半后半')
  })

  it('请求头带 Authorization 与 JSON Accept', async () => {
    const { fetchImpl, calls } = jsonFetch({ choices: [{ message: { content: 'ok' } }] })
    await run(fetchImpl)
    const headers = calls[0]?.init?.headers as Record<string, string>
    expect(headers['Authorization']).toBe('Bearer sk-test')
    expect(headers['Accept']).toBe('application/json')
  })

  it('OpenCode Go 档案带上 x-opencode-session', async () => {
    const { fetchImpl, calls } = jsonFetch({ choices: [{ message: { content: 'ok' } }] })
    await run(fetchImpl, { provider: 'opencode-go', baseUrl: 'https://opencode.ai/zen/go/v1' })
    const headers = calls[0]?.init?.headers as Record<string, string>
    expect(headers['x-opencode-session']).toBe('sess-1')
    expect(headers['User-Agent']).toBe('tool-box-mobile')
  })

  it('接口地址为空时直接报错，不发请求', async () => {
    const spy = vi.fn()
    await expect(run(spy as unknown as FetchLike, { baseUrl: '' })).rejects.toThrow(/接口地址不能为空/)
    expect(spy).not.toHaveBeenCalled()
  })

  it('提示词为空时直接报错', async () => {
    const spy = vi.fn()
    await expect(run(spy as unknown as FetchLike, { prompt: '   ' })).rejects.toThrow(/不能为空/)
    expect(spy).not.toHaveBeenCalled()
  })

  it('非 2xx 走错误文案映射（401）', async () => {
    const { fetchImpl } = textFetch('{"error":{"message":"Invalid API key"}}', 401)
    await expect(run(fetchImpl)).rejects.toThrow(/API Key/)
  })

  it('2xx 但正文带 error 时按错误处理', async () => {
    const { fetchImpl } = jsonFetch({ error: { message: 'Invalid API key' } })
    await expect(run(fetchImpl)).rejects.toThrow(/API Key/)
  })

  it('响应不是 JSON 时提示格式异常', async () => {
    const { fetchImpl } = textFetch('<html>502</html>')
    await expect(run(fetchImpl)).rejects.toThrow(/格式异常/)
  })

  it('正文为空时报「未返回内容」', async () => {
    const { fetchImpl } = jsonFetch({ choices: [{ message: { content: '   ' } }] })
    await expect(run(fetchImpl)).rejects.toThrow(/未返回内容/)
  })

  it('choices 为空时报「未返回内容」', async () => {
    const { fetchImpl } = jsonFetch({ choices: [] })
    await expect(run(fetchImpl)).rejects.toThrow(/未返回内容/)
  })

  it('外部中止抛 AbortError，便于调用方区分「已取消」', async () => {
    const controller = new AbortController()
    const fetchImpl: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const error = new Error('aborted')
          error.name = 'AbortError'
          reject(error)
        })
      })
    const work = run(fetchImpl, { signal: controller.signal })
    controller.abort()
    await expect(work).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('超时后报超时而不是 AbortError', async () => {
    const fetchImpl: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const error = new Error('aborted')
          error.name = 'AbortError'
          reject(error)
        })
      })
    await expect(run(fetchImpl, { timeoutMs: 10 })).rejects.toThrow(/超时/)
  })

  it('网络异常被归一成用户可读文案', async () => {
    const fetchImpl: FetchLike = () => Promise.reject(new Error('Network request failed'))
    await expect(run(fetchImpl)).rejects.toThrow(/无法连接|网络/)
  })
})
