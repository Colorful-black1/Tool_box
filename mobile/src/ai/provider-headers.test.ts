import { describe, expect, it } from 'vitest'

import { CLIENT_USER_AGENT, OPENCODE_SESSION_HEADER, buildChatHeaders, buildModelListHeaders, requiresSessionHeader } from './provider-headers'

const OPENCODE_GO = 'https://opencode.ai/zen/go/v1'

describe('requiresSessionHeader', () => {
  it('opencode-go 供应商需要会话头', () => {
    expect(requiresSessionHeader({ provider: 'opencode-go', baseUrl: 'https://example.com/v1' })).toBe(true)
  })

  it('按 host + 路径兜底识别 Go 网关', () => {
    expect(requiresSessionHeader({ provider: 'custom', baseUrl: OPENCODE_GO })).toBe(true)
    expect(requiresSessionHeader({ provider: 'custom', baseUrl: 'https://opencode.ai/zen/go/v1/' })).toBe(true)
  })

  // 关键回归：Zen 不是 Go，路径差一个 go
  it('opencode.ai 的非 Go 路径不需要', () => {
    expect(requiresSessionHeader({ provider: 'custom', baseUrl: 'https://opencode.ai/zen/v1' })).toBe(false)
    expect(requiresSessionHeader({ provider: 'custom', baseUrl: 'https://opencode.ai/v1' })).toBe(false)
  })

  it('其他供应商不需要', () => {
    for (const provider of ['deepseek', 'glm', 'mimo', 'openai', 'kimi', 'qwen', 'siliconflow', 'custom'] as const) {
      expect(requiresSessionHeader({ provider, baseUrl: 'https://api.example.com/v1' })).toBe(false)
    }
  })

  it('非法 baseUrl 不抛错，按不需要处理', () => {
    expect(requiresSessionHeader({ provider: 'custom', baseUrl: '不是 url' })).toBe(false)
  })
})

describe('buildChatHeaders', () => {
  it('普通供应商只有基础头', () => {
    const headers = buildChatHeaders({
      provider: 'deepseek',
      baseUrl: 'https://api.deepseek.com/v1',
      apiKey: 'sk-1',
      sessionId: 'c1'
    })
    expect(headers).toEqual({
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      Authorization: 'Bearer sk-1'
    })
  })

  // OpenCode Go 缺 x-opencode-session 直接 400
  it('opencode-go 追加会话头与客户端标识', () => {
    const headers = buildChatHeaders({
      provider: 'opencode-go',
      baseUrl: OPENCODE_GO,
      apiKey: 'sk-1',
      sessionId: 'conversation-42'
    })
    expect(headers[OPENCODE_SESSION_HEADER]).toBe('conversation-42')
    expect(headers['User-Agent']).toBe(CLIENT_USER_AGENT)
    expect(headers['Authorization']).toBe('Bearer sk-1')
  })

  it('自定义端点指向 Go 网关时同样追加', () => {
    const headers = buildChatHeaders({
      provider: 'custom',
      baseUrl: OPENCODE_GO,
      apiKey: 'sk-1',
      sessionId: 'c9'
    })
    expect(headers[OPENCODE_SESSION_HEADER]).toBe('c9')
  })

  it('会话头取传入的会话 id，不随机', () => {
    const input = {
      provider: 'opencode-go' as const,
      baseUrl: OPENCODE_GO,
      apiKey: 'sk-1',
      sessionId: 'stable-id'
    }
    expect(buildChatHeaders(input)[OPENCODE_SESSION_HEADER]).toBe('stable-id')
    expect(buildChatHeaders(input)[OPENCODE_SESSION_HEADER]).toBe('stable-id')
  })
})

describe('buildModelListHeaders', () => {
  it('请求模型列表用 JSON Accept', () => {
    const headers = buildModelListHeaders({
      provider: 'deepseek',
      baseUrl: 'https://api.deepseek.com/v1',
      apiKey: 'sk-1',
      sessionId: 'x'
    })
    expect(headers['Accept']).toBe('application/json')
  })

  it('Go 网关同样需要会话头', () => {
    const headers = buildModelListHeaders({
      provider: 'opencode-go',
      baseUrl: OPENCODE_GO,
      apiKey: 'sk-1',
      sessionId: 'tool-box-model-list'
    })
    expect(headers[OPENCODE_SESSION_HEADER]).toBe('tool-box-model-list')
    expect(headers['User-Agent']).toBe(CLIENT_USER_AGENT)
  })
})