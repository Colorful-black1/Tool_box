import { describe, expect, it } from 'vitest'

import {
  describeAiError,
  isContextOverflowError,
  normalizeOpenAiBaseUrl,
  parseContextLimit,
  validateChatInput
} from './errors'

describe('normalizeOpenAiBaseUrl', () => {
  it('adds /v1 to a bare host', () => {
    expect(normalizeOpenAiBaseUrl('https://api.example.com')).toBe(
      'https://api.example.com/v1'
    )
  })

  it('keeps an existing v1 path', () => {
    expect(normalizeOpenAiBaseUrl('https://api.example.com/v1')).toBe(
      'https://api.example.com/v1'
    )
  })

  it('removes a chat completions suffix', () => {
    expect(
      normalizeOpenAiBaseUrl('https://api.example.com/v1/chat/completions/')
    ).toBe('https://api.example.com/v1')
  })

  it('keeps another versioned path', () => {
    expect(normalizeOpenAiBaseUrl('https://api.example.com/api/v4')).toBe(
      'https://api.example.com/api/v4'
    )
  })

  it('returns an empty string for empty input', () => {
    expect(normalizeOpenAiBaseUrl('  ')).toBe('')
  })
})

describe('validateChatInput', () => {
  it('trims valid content', () => {
    expect(validateChatInput('  hello  ')).toBe('hello')
  })

  it('rejects empty content', () => {
    expect(() => validateChatInput('   ')).toThrow('消息内容不能为空')
  })
})

describe('上下文超长识别', () => {
  it('识别常见超长文案，包括 cause 链', () => {
    expect(isContextOverflowError(new Error('context_length_exceeded'))).toBe(true)
    expect(
      isContextOverflowError(new Error('maximum context length is 131072 tokens'))
    ).toBe(true)
    expect(isContextOverflowError(new Error('prompt is too long'))).toBe(true)
    const nested = new Error('400', {
      cause: new Error('This model maximum context length is 1048576 tokens')
    })
    expect(isContextOverflowError(nested)).toBe(true)
    expect(isContextOverflowError(new Error('429 rate limit'))).toBe(false)
  })

  it('解析错误里的真实窗口', () => {
    expect(parseContextLimit(new Error('maximum context length is 131072 tokens'))).toBe(131_072)
    expect(
      parseContextLimit(
        new Error('maximum context length is 1,048,576 tokens. However, your messages resulted in 2000000 tokens')
      )
    ).toBe(1_048_576)
    expect(parseContextLimit(new Error('context window of 200000'))).toBe(200_000)
    expect(parseContextLimit(new Error('context_length_exceeded: 32768'))).toBe(32_768)
  })

  it('忽略非数字、越界和普通错误', () => {
    expect(parseContextLimit(new Error('context window of lots'))).toBeNull()
    expect(parseContextLimit(new Error('maximum context length is 128 tokens'))).toBeNull()
    expect(parseContextLimit(new Error('maximum context length is 20000000 tokens'))).toBeNull()
    expect(parseContextLimit(new Error('429 rate limit'))).toBeNull()
  })

  it('用户文案不暴露供应商原文', () => {
    expect(describeAiError(new Error('maximum context length is 131072 tokens'))).toContain(
      '上下文超出模型窗口'
    )
  })
})

describe('describeAiError', () => {
  it('maps unauthorized errors', () => {
    expect(describeAiError(new Error('Request failed with status code 401'))).toBe(
      'API Key 无效或没有访问权限'
    )
  })

  it('redacts a leaked API key', () => {
    const secret = 'sk-1234567890abcdef'
    expect(describeAiError(new Error(`bad key ${secret}`), secret)).not.toContain(
      secret
    )
  })
})
