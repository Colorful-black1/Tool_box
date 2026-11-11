import { describe, expect, it } from 'vitest'

import {
  estimateMessageTokens,
  estimateMessagesTokens,
  estimateTextTokens,
  estimateToolsTokens
} from './context-tokens'

describe('estimateTextTokens', () => {
  it('空文本不计 token', () => {
    expect(estimateTextTokens('')).toBe(0)
  })

  it('中文按一字一 token 估算', () => {
    expect(estimateTextTokens('你好')).toBe(2)
    expect(estimateTextTokens('上下文压缩')).toBe(5)
  })

  it('英文按 3.5 字符一 token 向上取整', () => {
    expect(estimateTextTokens('abcd')).toBe(2)
    expect(estimateTextTokens('hello world')).toBe(4)
  })

  it('中英混排分别计算', () => {
    expect(estimateTextTokens('中a')).toBe(2)
    expect(estimateTextTokens('模型 GPT-5')).toBe(4)
  })

  it('中文标点与全角字符也按一 token 计', () => {
    expect(estimateTextTokens('你好，世界！')).toBe(6)
  })

  it('同一输入结果稳定', () => {
    const text = '这是一段用于测试稳定性的中文，mixed English 123。'
    expect(estimateTextTokens(text)).toBe(estimateTextTokens(text))
  })
})

describe('estimateMessageTokens / estimateMessagesTokens', () => {
  it('每条消息加固定结构开销', () => {
    expect(estimateMessageTokens({ content: '你好' })).toBe(10)
    expect(estimateMessageTokens({ content: '' })).toBe(8)
  })

  it('多条消息累加', () => {
    expect(estimateMessagesTokens([{ content: '你好' }, { content: 'abcd' }])).toBe(20)
    expect(estimateMessagesTokens([])).toBe(0)
  })
})

describe('estimateToolsTokens', () => {
  it('空工具列表为 0', () => {
    expect(estimateToolsTokens([])).toBe(0)
  })

  it('工具 schema 比纯文本多出结构开销', () => {
    const tool = { name: 'notes_list', description: '列出笔记' }
    expect(estimateToolsTokens([tool])).toBeGreaterThan(estimateTextTokens(JSON.stringify(tool)))
  })

  it('无法序列化的工具不抛异常', () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular
    expect(estimateToolsTokens([circular])).toBeGreaterThan(0)
  })
})
