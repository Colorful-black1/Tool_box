import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { ContextService, CompactionUnavailableError } from './context-service'
import { ToolboxStore } from '../chat-store/chat-store'
import type { SecretBox } from '../crypto/secret-box'
import type { ChatMessage, ModelContextLimitView } from '../../../shared/types'

const box: SecretBox = {
  encrypt: (value) => JSON.stringify(value),
  decrypt: (value) => JSON.parse(value)
}

let root = ''
let store: ToolboxStore
let service: ContextService

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'toolbox-context-'))
  store = new ToolboxStore(join(root, 'toolbox.db'), box)
  service = new ContextService(store, join(root, 'prompts'))
})

afterEach(async () => {
  store.close()
  await rm(root, { recursive: true, force: true })
})

function modelReturning(text: string): BaseChatModel {
  return {
    invoke: async () => ({ content: text })
  } as unknown as BaseChatModel
}

function fillConversation(count: number, chars = 200): { conversationId: string; messages: ChatMessage[] } {
  const conversation = store.createConversation()
  const messages: ChatMessage[] = []
  for (let index = 0; index < count; index++) {
    messages.push(
      store.appendMessage({
        conversationId: conversation.id,
        role: index % 2 === 0 ? 'user' : 'assistant',
        content: `第 ${index} 条：${'事实'.repeat(chars)}`
      })
    )
  }
  return { conversationId: conversation.id, messages }
}

function baseInput(conversationId: string, windowTokens: number, fixedTokens = 10) {
  const limit: ModelContextLimitView = {
    tokens: windowTokens,
    source: 'manual',
    updatedAtMs: 1
  }
  return {
    conversationId,
    model: 'test-model',
    provider: 'custom',
    baseUrl: 'https://api.example.com/v1',
    limit,
    systemPrompt: '系统'.repeat(fixedTokens),
    toolSchemas: [],
    lastUsage: null,
    autoCompact: true,
    compacting: false,
    summaryModel: modelReturning(
      ['## 用户目标与意图', '整理资料'].join('\n') + '\n' + '摘要内容'.repeat(100)
    ),
    signal: new AbortController().signal
  }
}

describe('ContextService', () => {
  it('没有检查点时按窗口与消息估算占用', async () => {
    const { conversationId, messages } = fillConversation(4)
    const view = await service.view(baseInput(conversationId, 128_000))

    expect(view.windowTokens).toBe(128_000)
    expect(view.windowSource).toBe('manual')
    expect(view.checkpoint).toBeNull()
    expect(view.messageCount).toBe(messages.length)
    expect(view.estimatedTokens).toBeGreaterThan(0)
    expect(view.breakdown.messages).toBeGreaterThan(0)
  })

  it('接口与手动都没有时按供应商目录兜底窗口', async () => {
    const { conversationId } = fillConversation(2)
    const view = await service.view({
      ...baseInput(conversationId, 128_000),
      provider: 'opencode-go',
      model: 'deepseek-v4.1-flash',
      limit: null
    })
    expect(view.windowTokens).toBe(1_000_000)
    expect(view.windowSource).toBe('catalog')
  })

  it('未超阈值时 prepare 原样返回，不调用摘要模型', async () => {
    const { conversationId, messages } = fillConversation(2)
    let called = 0
    const input = baseInput(conversationId, 128_000)
    input.summaryModel = {
      invoke: async () => {
        called += 1
        return { content: '不应被调用' }
      }
    } as unknown as BaseChatModel

    const prepared = await service.prepare(input)
    expect(prepared.compacted).toBe(false)
    expect(prepared.history.map((message) => message.id)).toEqual(messages.map((message) => message.id))
    expect(called).toBe(0)
  })

  it('超阈值时压缩较早消息并保留最近尾部', async () => {
    const { conversationId, messages } = fillConversation(30, 100)
    const input = baseInput(conversationId, 8_000)
    const prepared = await service.prepare(input)

    expect(prepared.compacted).toBe(true)
    expect(prepared.checkpoint).toBeDefined()
    expect(prepared.summary).toContain('用户目标')
    expect(prepared.history.length).toBeLessThan(messages.length)
    expect(store.latestCheckpoint(conversationId)?.summary).toContain('用户目标')

    // 下一轮只从检查点边界之后取消息
    const after = store.listMessagesAfter(
      conversationId,
      store.latestCheckpoint(conversationId)?.coveredMessageId ?? null
    )
    expect(after.map((message) => message.id)).toEqual(prepared.history.map((message) => message.id))
  })

  it('摘要没有变小视为失败，自动压缩退回裁剪', async () => {
    const { conversationId, messages } = fillConversation(30, 100)
    const input = baseInput(conversationId, 8_000)
    input.summaryModel = modelReturning('相同大小'.repeat(4_000))

    const prepared = await service.prepare(input)
    expect(prepared.compacted).toBe(false)
    expect(prepared.fallbackDropped).toBeGreaterThan(0)
    expect(prepared.history.length).toBeLessThan(messages.length)
    expect(store.latestCheckpoint(conversationId)).toBeNull()
  })

  it('force 压缩在未达阈值时也执行，供超长错误恢复使用', async () => {
    const { conversationId } = fillConversation(80, 100)
    const prepared = await service.prepare({
      ...baseInput(conversationId, 128_000),
      force: true
    })
    expect(prepared.compacted).toBe(true)
    expect(prepared.checkpoint).toBeDefined()
  })

  it('手动压缩在消息太少时返回无需压缩', async () => {
    const { conversationId } = fillConversation(2)
    const result = await service.compact(baseInput(conversationId, 8_000))
    expect(result.compacted).toBe(false)
    expect(result.message).toContain('无需压缩')
  })

  it('手动压缩失败会抛出可读错误', async () => {
    const { conversationId } = fillConversation(30, 100)
    const input = baseInput(conversationId, 8_000)
    input.summaryModel = modelReturning('太短')
    await expect(service.compact(input)).rejects.toBeInstanceOf(CompactionUnavailableError)
  })
})
