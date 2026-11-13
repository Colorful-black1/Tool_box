import { describe, expect, it } from 'vitest'

import {
  CLIENT_USER_AGENT,
  buildProviderHeaders,
  processSessionIdForSingleCall,
  requiresCustomUserAgent,
  withPinnedUserAgent
} from './provider-headers'

describe('buildProviderHeaders', () => {
  it('adds a stable session header for OpenCode Go', () => {
    expect(
      buildProviderHeaders({
        provider: 'opencode-go',
        baseUrl: 'https://opencode.ai/zen/go/v1',
        sessionId: 'conversation-1'
      })
    ).toEqual({ 'x-opencode-session': 'conversation-1' })
  })

  it('detects the Go gateway from a custom base URL', () => {
    const headers = buildProviderHeaders({
      provider: 'custom',
      baseUrl: 'https://opencode.ai/zen/go/v1/',
      sessionId: 'abc'
    })

    expect(headers['x-opencode-session']).toBe('abc')
  })

  it('does not treat OpenCode Zen as Go', () => {
    for (const [provider, baseUrl] of [
      ['opencode-zen', 'https://opencode.ai/zen/v1'],
      ['custom', 'https://opencode.ai/zen/v1']
    ] as const) {
      expect(buildProviderHeaders({ provider, baseUrl, sessionId: 'abc' })).toEqual({})
      expect(requiresCustomUserAgent({ provider, baseUrl, sessionId: 'abc' })).toBe(false)
    }
  })

  it('returns no headers for other OpenAI-compatible providers', () => {
    for (const baseUrl of [
      'https://api.deepseek.com/v1',
      'https://open.bigmodel.cn/api/paas/v4',
      'https://api.xiaomimimo.com/v1',
      'not-a-url'
    ]) {
      expect(buildProviderHeaders({ provider: 'custom', baseUrl, sessionId: 'abc' })).toEqual({})
      expect(
        requiresCustomUserAgent({ provider: 'custom', baseUrl, sessionId: 'abc' })
      ).toBe(false)
    }
  })
})

describe('withPinnedUserAgent', () => {
  it('replaces only the user agent and keeps other headers', async () => {
    // 用数组收集，避免 TS 把闭包内赋值的变量收窄成 never
    const captured: Headers[] = []
    const stub = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      captured.push(new Headers(init?.headers))
      return new Response('{}')
    }) as typeof fetch

    const wrapped = withPinnedUserAgent(stub)
    await wrapped('https://example.com', {
      headers: { 'User-Agent': 'langchainjs-openai/1.0.0', 'x-opencode-session': 'abc' }
    })

    expect(captured[0]?.get('user-agent')).toBe(CLIENT_USER_AGENT)
    expect(captured[0]?.get('x-opencode-session')).toBe('abc')
  })
})

describe('processSessionIdForSingleCall', () => {
  it('stays stable across calls within one process', () => {
    expect(processSessionIdForSingleCall()).toBe(processSessionIdForSingleCall())
  })
})
