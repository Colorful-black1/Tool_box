import { describe, expect, it, vi } from 'vitest'

import { buildChatBody, isAbortError, normalizeNetworkMessage, streamChat } from './stream-chat'
import type { FetchLike } from './stream-chat'
import type { ChatMessage } from '../shared-bridge'

/** 把 SSE 文本编码成若干 Uint8Array，可指定字节切分以模拟任意分块 */
function toChunks(text: string, byteSize: number): Uint8Array[] {
  const bytes = new TextEncoder().encode(text)
  const out: Uint8Array[] = []
  for (let i = 0; i < bytes.length; i += byteSize) out.push(bytes.slice(i, i + byteSize))
  return out
}

/** 构造一个假的 SSE 响应体 */
function sseResponse(text: string, byteSize = text.length): Response {
  const chunks = toChunks(text, byteSize)
  let index = 0
  const body = {
    getReader() {
      return {
        read: () =>
          Promise.resolve(
            index < chunks.length
              ? { done: false, value: chunks[index++] }
              : { done: true, value: undefined }
          ),
        cancel: () => Promise.resolve()
      }
    }
  }
  return { ok: true, status: 200, body, text: () => Promise.resolve(text) } as unknown as Response
}

function delta(content: string): string {
  return `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`
}

const HISTORY: ChatMessage[] = [
  {
    id: 'm1',
    conversationId: 'c1',
    role: 'user',
    content: '你好',
    createdAtMs: 1
  }
]

function baseInput(fetchImpl: FetchLike) {
  return {
    baseUrl: 'https://api.deepseek.com/v1',
    apiKey: 'sk-test',
    model: 'deepseek-v4-pro',
    provider: 'deepseek' as const,
    sessionId: 'c1',
    messages: HISTORY,
    signal: new AbortController().signal,
    timeoutMs: 5000,
    onDelta: () => {},
    fetchImpl
  }
}

/** 恒定返回某个响应的假 fetch */
function okFetch(text: string, byteSize?: number): FetchLike {
  return () => Promise.resolve(sseResponse(text, byteSize))
}

describe('buildChatBody', () => {
  it('生成 OpenAI 兼容请求体', () => {
    const body = JSON.parse(
      buildChatBody({ model: 'm', messages: HISTORY, temperature: 0.7 })
    ) as Record<string, unknown>
    expect(body['model']).toBe('m')
    expect(body['stream']).toBe(true)
    expect(body['temperature']).toBe(0.7)
    expect(body['messages']).toEqual([{ role: 'user', content: '你好' }])
  })
})

describe('streamChat 增量输出', () => {
  it('按顺序吐出每个增量并累积完整正文', async () => {
    const deltas: string[] = []
    const fetchImpl = okFetch(delta('星') + delta('轨') + delta('对话') + 'data: [DONE]\n\n')
    const result = await streamChat({ ...baseInput(fetchImpl), onDelta: (d) => deltas.push(d) })

    expect(deltas).toEqual(['星', '轨', '对话'])
    expect(result.content).toBe('星轨对话')
    expect(result.completed).toBe(true)
  })

  // 关键回归：一个中文字符 3 字节，分块不当会出现乱码
  it('中文跨字节边界不乱码', async () => {
    const text = delta('星') + delta('轨') + delta('对话') + delta('测试') + 'data: [DONE]\n\n'
    for (const byteSize of [1, 2, 3, 5, 7, 13]) {
      const deltas: string[] = []
      const fetchImpl = okFetch(text, byteSize)
      const result = await streamChat({ ...baseInput(fetchImpl), onDelta: (d) => deltas.push(d) })
      expect(deltas.join('')).toBe('星轨对话测试')
      expect(result.content).toBe('星轨对话测试')
    }
  })

  it('跳过无 content 的 chunk', async () => {
    const text =
      `data: ${JSON.stringify({ choices: [{ delta: { role: 'assistant' } }] })}\n\n` +
      delta('a') +
      `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\n` +
      'data: [DONE]\n\n'
    const deltas: string[] = []
    const result = await streamChat({ ...baseInput(okFetch(text)), onDelta: (d) => deltas.push(d) })
    expect(deltas).toEqual(['a'])
    expect(result.content).toBe('a')
  })

  it('忽略心跳注释行', async () => {
    const text = ': ping\n\n' + delta('ok') + 'data: [DONE]\n\n'
    const result = await streamChat({ ...baseInput(okFetch(text)) })
    expect(result.content).toBe('ok')
  })

  it('流未收到 [DONE] 也返回已累积内容', async () => {
    const result = await streamChat({ ...baseInput(okFetch(delta('半句'))) })
    expect(result.completed).toBe(false)
    expect(result.content).toBe('半句')
  })

  it('收到 [DONE] 后中止请求，避免连接挂着', async () => {
    const captured: RequestInit[] = []
    const fetchImpl: FetchLike = (url, init) => {
      captured.push(init ?? {})
      return Promise.resolve(sseResponse(delta('a') + 'data: [DONE]\n\n'))
    }
    await streamChat(baseInput(fetchImpl))
    const signal = captured[0]?.signal
    expect(signal?.aborted).toBe(true)
  })
})

describe('streamChat 错误处理', () => {
  it('401 映射为 Key 无效', async () => {
    const body = JSON.stringify({ error: { message: 'Invalid API key provided' } })
    const fetchImpl: FetchLike = () =>
      Promise.resolve({ ok: false, status: 401, text: () => Promise.resolve(body) } as unknown as Response)
    await expect(streamChat(baseInput(fetchImpl))).rejects.toThrow(/API Key 无效/)
  })

  it('429 映射为频率受限', async () => {
    const body = JSON.stringify({ error: { message: 'rate limit exceeded' } })
    const fetchImpl: FetchLike = () =>
      Promise.resolve({ ok: false, status: 429, text: () => Promise.resolve(body) } as unknown as Response)
    await expect(streamChat(baseInput(fetchImpl))).rejects.toThrow(/频率或额度受限/)
  })

  it('流中途出现 error 字段立即失败', async () => {
    const text = delta('a') + `data: ${JSON.stringify({ error: { message: 'quota exceeded' } })}\n\n`
    await expect(streamChat(baseInput(okFetch(text)))).rejects.toThrow(/频率或额度受限/)
  })

  it('JSON 解析失败报格式异常', async () => {
    await expect(streamChat(baseInput(okFetch('data: {不是json\n\n')))).rejects.toThrow(/格式异常/)
  })

  it('空响应体报错', async () => {
    const fetchImpl: FetchLike = () => Promise.resolve({ ok: true, status: 200, body: null } as unknown as Response)
    await expect(streamChat(baseInput(fetchImpl))).rejects.toThrow(/响应为空/)
  })

  it('空接口地址报错', async () => {
    const input = { ...baseInput(okFetch('')), baseUrl: '  ' }
    await expect(streamChat(input)).rejects.toThrow(/接口地址不能为空/)
  })

  it('错误文案里不出现 API Key', async () => {
    // redactSecret 只对长度 ≥ 8 的密钥生效，这里用真实长度的 Key
    const apiKey = 'sk-secret-value-123456'
    const body = JSON.stringify({ error: { message: `bad key ${apiKey}` } })
    const fetchImpl: FetchLike = () =>
      Promise.resolve({ ok: false, status: 400, text: () => Promise.resolve(body) } as unknown as Response)
    await expect(streamChat({ ...baseInput(fetchImpl), apiKey })).rejects.toThrow(/已隐藏/)
  })

  // 关键回归：RN 的网络异常文案是 Network request failed，桌面端词表覆盖不到
  it('RN 网络异常文案能映射到用户可读提示', async () => {
    const fetchImpl: FetchLike = () => Promise.reject(new Error('Network request failed'))
    await expect(streamChat(baseInput(fetchImpl))).rejects.toThrow(/无法连接 AI 服务/)
  })
})

describe('streamChat 中止与超时', () => {
  it('用户主动停止抛 AbortError（不报错）', async () => {
    const controller = new AbortController()
    const fetchImpl: FetchLike = () => {
      controller.abort()
      return Promise.reject(new Error('aborted'))
    }
    const input = { ...baseInput(fetchImpl), signal: controller.signal }
    await expect(streamChat(input)).rejects.toSatisfy(isAbortError)
  })

  it('已经处于 aborted 状态的 signal 直接中止', async () => {
    const controller = new AbortController()
    controller.abort()
    const fetchImpl: FetchLike = () => Promise.reject(new Error('aborted'))
    const input = { ...baseInput(fetchImpl), signal: controller.signal }
    await expect(streamChat(input)).rejects.toSatisfy(isAbortError)
  })

  it('超时按超时文案报错，而不是 AbortError', async () => {
    const fetchImpl: FetchLike = () => new Promise<Response>(() => {})
    const input = { ...baseInput(fetchImpl), timeoutMs: 20 }
    await expect(streamChat(input)).rejects.toThrow(/请求超时/)
  })

  it('结束后清理定时器与监听', async () => {
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout')
    await streamChat(baseInput(okFetch(delta('a') + 'data: [DONE]\n\n')))
    expect(clearSpy).toHaveBeenCalled()
    clearSpy.mockRestore()
  })

  it('onAbort 回调被调用一次', async () => {
    const onAbort = vi.fn()
    await streamChat({ ...baseInput(okFetch(delta('a'))), onAbort })
    expect(onAbort).toHaveBeenCalledTimes(1)
  })
})

describe('normalizeNetworkMessage', () => {
  it('把 RN 的网络文案换成桌面端词表能识别的形式', () => {
    expect(normalizeNetworkMessage(new Error('Network request failed'))).toBe('fetch failed')
    expect(normalizeNetworkMessage(new Error('其他错误'))).toBe('其他错误')
  })
})