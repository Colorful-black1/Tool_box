import { describe, expect, it } from 'vitest'

import {
  describeAiError,
  normalizeOpenAiBaseUrl,
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
