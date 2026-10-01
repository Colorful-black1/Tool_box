import { describe, expect, it, vi } from 'vitest'

import { AiGateway } from './ai-gateway'
import type { ChatEventSink } from './ai-gateway'
import type { FetchLike } from './stream-chat'
import type { AiSettingsService } from './ai-settings'
import type { MobileStore } from '../data/store'

interface StoredMessage {
  role: 'user' | 'assistant'
  content: string
}

/** 内存版会话存储：只实现网关用到的方法 */
class FakeStore {
  readonly messages: StoredMessage[] = []
  title = '新对话'
  renameCalls = 0
  private streamMs = 0

  constructor() {
    this.messages = []
  }

  async getConversation(id: string) {
    if (id === 'missing') return null
    return {
      id,
      title: this.title,
      createdAtMs: 1,
      updatedAtMs: 1,
      messageCount: this.messages.length
    }
  }

  async appendMessage(input: { conversationId: string; role: 'user' | 'assistant'; content: string }) {
    this.messages.push({ role: input.role, content: input.content })
    return {
      id: `m-${this.messages.length}`,
      conversationId: input.conversationId,
      role: input.role,
      content: input.content,
      createdAtMs: Date.now()
    }
  }

  async listMessages() {
    return this.messages.map((message, index) => ({
      id: `m-${index + 1}`,
      conversationId: 'c1',
      role: message.role,
      content: message.content,
      createdAtMs: index + 1
    }))
  }

  async renameConversation(_id: string, title: string) {
    this.renameCalls += 1
    this.title = title
    return this.getConversation('c1')
  }
}

const CONFIG = {
  provider: 'deepseek' as const,
  baseUrl: 'https://api.deepseek.com/v1',
  model: 'deepseek-v4-pro',
  apiKey: 'sk-1'
}

function fakeSettings(): AiSettingsService {
  return {
    getActiveConfig: () => Promise.resolve(CONFIG)
  } as unknown as AiSettingsService
}

/** 生成一条 SSE 响应 */
function sseFetch(text: string, gate?: Promise<void>): FetchLike {
  return () => {
    const work = async (): Promise<Response> => {
      if (gate) await gate
      const bytes = new TextEncoder().encode(text)
      let index = 0
      return {
        ok: true,
        status: 200,
        body: {
          getReader: () => ({
            read: () => {
              if (index >= bytes.length) return Promise.resolve({ done: true, value: undefined })
              const value = bytes.slice(index, index + 3)
              index += 3
              return Promise.resolve({ done: false, value })
            },
            cancel: () => Promise.resolve()
          })
        },
        text: () => Promise.resolve(text)
      } as unknown as Response
    }
    return work()
  }
}

function delta(content: string): string {
  return `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`
}

function recordingSink(): ChatEventSink & {
  events: string[]
  deltas: string[]
  stopped: number
  errors: string[]
} {
  const events: string[] = []
  const deltas: string[] = []
  const errors: string[] = []
  const sink = {
    events,
    deltas,
    errors,
    stopped: 0,
    onDelta: (event: { delta: string }) => {
      events.push('delta')
      deltas.push(event.delta)
    },
    onCompleted: () => events.push('completed'),
    onError: (event: { message: string }) => {
      events.push('error')
      errors.push(event.message)
    },
    onStopped: () => {
      events.push('stopped')
      sink.stopped += 1
    }
  }
  return sink
}

/** 等待后台流跑到终态（completed / stopped / error），而不是固定睡眠 */
function waitFor(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now()
    const tick = (): void => {
      if (predicate()) return resolve()
      if (Date.now() - started > timeoutMs) return reject(new Error('等待后台流超时'))
      setTimeout(tick, 2)
    }
    tick()
  })
}

describe('AiGateway.send', () => {
  it('先落库 user 消息并立即返回，流在后台跑', async () => {
    const store = new FakeStore()
    const gate = Promise.withResolvers<void>()
    const gateway = new AiGateway(
      fakeSettings(),
      store as unknown as MobileStore,
      sseFetch(delta('回复') + 'data: [DONE]\n\n', gate.promise)
    )
    const sink = recordingSink()

    const result = await gateway.send('c1', '你好', sink)
    expect(result.userMessage.content).toBe('你好')
    // 此刻流还没放行，assistant 消息尚未落库
    expect(store.messages).toHaveLength(1)
    expect(gateway.isStreaming('c1')).toBe(true)

    gate.resolve()
    await waitFor(() => !gateway.isStreaming('c1'))

    expect(sink.deltas).toEqual(['回复'])
    expect(sink.events).toContain('completed')
    expect(store.messages[1]).toEqual({ role: 'assistant', content: '回复' })
    expect(gateway.isStreaming('c1')).toBe(false)
  })

  it('发给模型的历史包含本轮 user 消息', async () => {
    const store = new FakeStore()
    let sentBody = ''
    const fetchImpl: FetchLike = (_url, init) => {
      sentBody = String(init?.body ?? '')
      return sseFetch(delta('ok') + 'data: [DONE]\n\n')(_url, init)
    }
    const gateway = new AiGateway(fakeSettings(), store as unknown as MobileStore, fetchImpl)

    await gateway.send('c1', '我的问题', recordingSink())
    await waitFor(() => sentBody !== '')

    expect(JSON.parse(sentBody).messages).toEqual([{ role: 'user', content: '我的问题' }])
  })

  it('首次对话用内容当标题', async () => {
    const store = new FakeStore()
    const gateway = new AiGateway(
      fakeSettings(),
      store as unknown as MobileStore,
      sseFetch(delta('ok') + 'data: [DONE]\n\n')
    )

    await gateway.send('c1', '  你好呀世界  ', recordingSink())
    expect(store.renameCalls).toBe(1)
    expect(store.title).toBe('你好呀世界')
  })

  it('已有标题不再覆盖', async () => {
    const store = new FakeStore()
    store.title = '已有标题'
    const gateway = new AiGateway(
      fakeSettings(),
      store as unknown as MobileStore,
      sseFetch(delta('ok') + 'data: [DONE]\n\n')
    )

    await gateway.send('c1', '新内容', recordingSink())
    expect(store.renameCalls).toBe(0)
    expect(store.title).toBe('已有标题')
  })

  it('内容为空报错且不发请求', async () => {
    const store = new FakeStore()
    const fetchImpl = vi.fn()
    const gateway = new AiGateway(fakeSettings(), store as unknown as MobileStore, fetchImpl as never)

    await expect(gateway.send('c1', '   ', recordingSink())).rejects.toThrow(/不能为空/)
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(store.messages).toHaveLength(0)
  })

  it('会话不存在报错', async () => {
    const store = new FakeStore()
    const gateway = new AiGateway(fakeSettings(), store as unknown as MobileStore, sseFetch(''))
    await expect(gateway.send('missing', 'hi', recordingSink())).rejects.toThrow(/会话不存在/)
  })

  // 关键回归：同一会话并发只允许一个流
  it('重复 send 同一会话报错', async () => {
    const store = new FakeStore()
    const gate = Promise.withResolvers<void>()
    const gateway = new AiGateway(
      fakeSettings(),
      store as unknown as MobileStore,
      sseFetch(delta('x') + 'data: [DONE]\n\n', gate.promise)
    )

    await gateway.send('c1', '第一句', recordingSink())
    await expect(gateway.send('c1', '第二句', recordingSink())).rejects.toThrow(/正在生成回复/)

    gate.resolve()
    await waitFor(() => !gateway.isStreaming('c1'))
  })

  it('不同会话可以并发', async () => {
    const store = new FakeStore()
    const gate = Promise.withResolvers<void>()
    const gateway = new AiGateway(
      fakeSettings(),
      store as unknown as MobileStore,
      sseFetch(delta('x') + 'data: [DONE]\n\n', gate.promise)
    )

    await gateway.send('c1', '甲', recordingSink())
    await expect(gateway.send('c2', '乙', recordingSink())).resolves.toBeTruthy()

    gate.resolve()
    await waitFor(() => !gateway.isStreaming('c1') && !gateway.isStreaming('c2'))
  })
})

describe('AiGateway.stop', () => {
  it('停止时发 stopped 而不是 error，且不落库 assistant 消息', async () => {
    const store = new FakeStore()
    const gate = Promise.withResolvers<void>()
    const gateway = new AiGateway(
      fakeSettings(),
      store as unknown as MobileStore,
      sseFetch(delta('半句') + 'data: [DONE]\n\n', gate.promise)
    )
    const sink = recordingSink()

    await gateway.send('c1', '问题', sink)
    gateway.stop('c1')
    gate.resolve()
    await waitFor(() => sink.stopped === 1)

    expect(sink.events).toContain('stopped')
    expect(sink.events).not.toContain('error')
    // 停止时已收到的增量丢弃，不落库
    expect(store.messages).toHaveLength(1)
  })

  it('停止后 active 被清理，可以再次发送', async () => {
    const store = new FakeStore()
    const gate = Promise.withResolvers<void>()
    const gateway = new AiGateway(
      fakeSettings(),
      store as unknown as MobileStore,
      sseFetch(delta('x') + 'data: [DONE]\n\n', gate.promise)
    )

    await gateway.send('c1', '问题', recordingSink())
    gateway.stop('c1')
    gate.resolve()
    await waitFor(() => !gateway.isStreaming('c1'))

    expect(gateway.isStreaming('c1')).toBe(false)
    await expect(gateway.send('c1', '再来一次', recordingSink())).resolves.toBeTruthy()
    gate.resolve()
    await waitFor(() => !gateway.isStreaming('c1'))
  })

  it('停止不存在的流不抛错', () => {
    const gateway = new AiGateway(fakeSettings(), new FakeStore() as unknown as MobileStore, sseFetch(''))
    expect(() => gateway.stop('nobody')).not.toThrow()
  })
})

describe('AiGateway 失败路径', () => {
  it('服务端错误走 onError 并清理 active', async () => {
    const store = new FakeStore()
    const gateway = new AiGateway(
      fakeSettings(),
      store as unknown as MobileStore,
      sseFetch(`data: ${JSON.stringify({ error: { message: 'Invalid API key' } })}\n\n`)
    )
    const sink = recordingSink()

    await gateway.send('c1', '问题', sink)
    await waitFor(() => sink.errors.length > 0)

    expect(sink.errors[0]).toMatch(/API Key 无效/)
    expect(gateway.isStreaming('c1')).toBe(false)
  })

  it('AI 没返回内容时报错', async () => {
    const store = new FakeStore()
    const gateway = new AiGateway(
      fakeSettings(),
      store as unknown as MobileStore,
      sseFetch(`data: ${JSON.stringify({ choices: [{ delta: { role: 'assistant' } }] })}\n\n`)
    )
    const sink = recordingSink()

    await gateway.send('c1', '问题', sink)
    await waitFor(() => sink.errors.length > 0)

    expect(sink.errors[0]).toMatch(/未返回内容/)
    expect(gateway.isStreaming('c1')).toBe(false)
  })

  it('失败后仍可再次发送', async () => {
    const store = new FakeStore()
    const gateway = new AiGateway(
      fakeSettings(),
      store as unknown as MobileStore,
      sseFetch('data: {不是json\n\n')
    )

    await gateway.send('c1', '问题', recordingSink())
    await waitFor(() => !gateway.isStreaming('c1'))

    expect(gateway.isStreaming('c1')).toBe(false)
    await expect(gateway.send('c1', '再来', recordingSink())).resolves.toBeTruthy()
    await waitFor(() => !gateway.isStreaming('c1'))
  })
})