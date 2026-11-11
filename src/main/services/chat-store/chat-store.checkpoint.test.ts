import Database from 'better-sqlite3'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { ToolboxStore } from './chat-store'
import type { SecretBox } from '../crypto/secret-box'

const box: SecretBox = {
  encrypt: (value) => JSON.stringify(value),
  decrypt: (value) => JSON.parse(value)
}

let root = ''
let store: ToolboxStore
let dbPath = ''

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'toolbox-checkpoint-'))
  dbPath = join(root, 'toolbox.db')
  store = new ToolboxStore(dbPath, box)
})

afterEach(async () => {
  store.close()
  await rm(root, { recursive: true, force: true })
})

describe('对话检查点', () => {
  it('没有检查点时返回 null，边界之后返回原文消息', () => {
    const conversation = store.createConversation()
    const first = store.appendMessage({ conversationId: conversation.id, role: 'user', content: '一' })
    const second = store.appendMessage({
      conversationId: conversation.id,
      role: 'assistant',
      content: '二'
    })
    const third = store.appendMessage({ conversationId: conversation.id, role: 'user', content: '三' })

    expect(store.latestCheckpoint(conversation.id)).toBeNull()
    expect(store.listMessagesAfter(conversation.id, second.id).map((item) => item.id)).toEqual([
      third.id
    ])

    const checkpoint = store.insertCheckpoint({
      conversationId: conversation.id,
      summary: '摘要',
      coveredMessageId: second.id,
      coveredMessageCount: 2,
      omittedMessageCount: 0,
      summaryTokens: 10,
      sourceTokens: 100,
      model: 'test-model'
    })

    expect(checkpoint.coveredMessageId).toBe(second.id)
    expect(store.latestCheckpoint(conversation.id)).toMatchObject({
      summary: '摘要',
      coveredMessageCount: 2,
      tokens: 10
    })
    expect(store.listMessagesAfter(conversation.id, null).map((item) => item.id)).toEqual([
      first.id,
      second.id,
      third.id
    ])
  })

  it('边界消息不存在时回退为全部消息', () => {
    const conversation = store.createConversation()
    const message = store.appendMessage({
      conversationId: conversation.id,
      role: 'user',
      content: '唯一'
    })
    expect(store.listMessagesAfter(conversation.id, 'missing').map((item) => item.id)).toEqual([
      message.id
    ])
  })

  it('多条检查点取最新一条', () => {
    const conversation = store.createConversation()
    const first = store.appendMessage({ conversationId: conversation.id, role: 'user', content: '一' })
    const second = store.appendMessage({
      conversationId: conversation.id,
      role: 'assistant',
      content: '二'
    })

    store.insertCheckpoint({
      conversationId: conversation.id,
      summary: '旧摘要',
      coveredMessageId: first.id,
      coveredMessageCount: 1,
      omittedMessageCount: 0,
      summaryTokens: 5,
      sourceTokens: 50,
      model: 'm'
    })
    store.insertCheckpoint({
      conversationId: conversation.id,
      summary: '新摘要',
      coveredMessageId: second.id,
      coveredMessageCount: 2,
      omittedMessageCount: 1,
      summaryTokens: 6,
      sourceTokens: 60,
      model: 'm'
    })

    expect(store.latestCheckpoint(conversation.id)?.summary).toBe('新摘要')
  })

  it('删除会话级联删除检查点', () => {
    const conversation = store.createConversation()
    const message = store.appendMessage({
      conversationId: conversation.id,
      role: 'user',
      content: '一'
    })
    store.insertCheckpoint({
      conversationId: conversation.id,
      summary: '摘要',
      coveredMessageId: message.id,
      coveredMessageCount: 1,
      omittedMessageCount: 0,
      summaryTokens: 5,
      sourceTokens: 50,
      model: 'm'
    })

    store.deleteConversation(conversation.id)

    const raw = new Database(dbPath, { readonly: true })
    try {
      const count = raw
        .prepare('SELECT COUNT(*) AS count FROM conversation_checkpoints')
        .get() as { count: number }
      expect(count.count).toBe(0)
    } finally {
      raw.close()
    }
  })

  it('v6 数据库升级到 v7 后可以写检查点', async () => {
    const conversation = store.createConversation()
    const message = store.appendMessage({
      conversationId: conversation.id,
      role: 'user',
      content: '一'
    })
    const conversationId = conversation.id
    const messageId = message.id

    store.close()
    const downgraded = new Database(dbPath)
    try {
      downgraded.exec('DROP TABLE conversation_checkpoints; PRAGMA user_version = 6;')
    } finally {
      downgraded.close()
    }

    store = new ToolboxStore(dbPath, box)
    expect(store.latestCheckpoint(conversationId)).toBeNull()
    const checkpoint = store.insertCheckpoint({
      conversationId,
      summary: '升级后的摘要',
      coveredMessageId: messageId,
      coveredMessageCount: 1,
      omittedMessageCount: 0,
      summaryTokens: 5,
      sourceTokens: 50,
      model: 'm'
    })
    expect(checkpoint.summary).toBe('升级后的摘要')
  })
})
