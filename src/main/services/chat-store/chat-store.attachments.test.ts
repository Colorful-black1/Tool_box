import Database from 'better-sqlite3'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { SecretBox } from '../crypto/secret-box'
import { ToolboxStore } from './chat-store'

const box: SecretBox = {
  encrypt: (value) => JSON.stringify(value),
  decrypt: (value) => JSON.parse(value)
}

let root = ''
let dbPath = ''
let store: ToolboxStore

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'toolbox-attachments-'))
  dbPath = join(root, 'toolbox.db')
  store = new ToolboxStore(dbPath, box)
})

afterEach(async () => {
  store.close()
  await rm(root, { recursive: true, force: true })
})

describe('对话附件存储', () => {
  it('消息与附件路径同事务落库，列表只返回元数据', () => {
    const conversation = store.createConversation()
    const message = store.appendMessageWithAttachments({
      conversationId: conversation.id,
      role: 'user',
      content: '看看这两个文件',
      attachments: [
        {
          kind: 'text',
          name: 'notes.md',
          mime: 'text/plain',
          sizeBytes: 12,
          filePath: join(root, 'notes.md'),
          textChars: 8,
          textTokens: 6,
          truncated: false
        },
        {
          kind: 'image',
          name: 'chart.png',
          mime: 'image/jpeg',
          sizeBytes: 2048,
          filePath: join(root, 'chart.png'),
          width: 800,
          height: 600,
          truncated: false
        }
      ]
    })

    expect(message.attachments).toHaveLength(2)
    const listed = store.listMessages(conversation.id)
    expect(listed).toHaveLength(1)
    expect(listed[0].attachments?.[0]).toMatchObject({
      kind: 'text',
      name: 'notes.md',
      textChars: 8,
      textTokens: 6,
      truncated: false
    })
    expect(listed[0].attachments?.[0].text).toBeUndefined()
    expect(listed[0].attachments?.[1]).toMatchObject({
      kind: 'image',
      name: 'chart.png',
      width: 800,
      height: 600
    })
  })

  it('按 id 返回源文件路径，供模型读取或系统打开', () => {
    const conversation = store.createConversation()
    const message = store.appendMessageWithAttachments({
      conversationId: conversation.id,
      role: 'user',
      content: '',
      attachments: [
        {
          kind: 'text',
          name: 'a.txt',
          mime: 'text/plain',
          sizeBytes: 2,
          filePath: join(root, 'a.txt'),
          textChars: 1,
          textTokens: 1,
          truncated: false
        },
        {
          kind: 'image',
          name: 'b.png',
          mime: 'image/jpeg',
          sizeBytes: 9,
          filePath: join(root, 'b.png'),
          width: 10,
          height: 20,
          truncated: false
        }
      ]
    })
    const [textAttachment, imageAttachment] = message.attachments ?? []

    expect(store.getAttachmentFile(textAttachment.id)).toMatchObject({
      filePath: join(root, 'a.txt'),
      name: 'a.txt',
      kind: 'text'
    })
    const files = store.attachmentFiles([textAttachment.id, imageAttachment.id])
    expect(files.get(imageAttachment.id)?.filePath).toBe(join(root, 'b.png'))
    expect(store.hasImageAttachments(conversation.id)).toBe(true)
  })

  it('删除会话时附件记录级联删除', () => {
    const conversation = store.createConversation()
    const message = store.appendMessageWithAttachments({
      conversationId: conversation.id,
      role: 'user',
      content: '',
      attachments: [
        {
          kind: 'text',
          name: 'a.txt',
          mime: 'text/plain',
          sizeBytes: 2,
          filePath: join(root, 'a.txt'),
          truncated: false
        }
      ]
    })
    const attachmentId = message.attachments![0].id
    store.deleteConversation(conversation.id)
    expect(() => store.getAttachmentFile(attachmentId)).toThrow('附件不存在')
  })

  it('v8 数据库升级到 v9 时自动创建路径附件表', () => {
    store.close()
    const raw = new Database(dbPath)
    raw.exec('DROP TABLE chat_attachments')
    raw.pragma('user_version = 8')
    raw.close()

    store = new ToolboxStore(dbPath, box)
    expect(() => store.getAttachmentFile('missing')).toThrow('附件不存在')
    const reopened = new Database(dbPath, { readonly: true })
    expect(reopened.pragma('user_version', { simple: true })).toBe(9)
    const columns = reopened.prepare('PRAGMA table_info(chat_attachments)').all() as Array<{
      name: string
    }>
    expect(columns.map((column) => column.name)).toEqual(
      expect.arrayContaining(['file_path', 'text_chars', 'text_tokens'])
    )
    expect(columns.map((column) => column.name)).not.toEqual(
      expect.arrayContaining(['text_content', 'image_data', 'thumb_data'])
    )
    reopened.close()
  })
})
