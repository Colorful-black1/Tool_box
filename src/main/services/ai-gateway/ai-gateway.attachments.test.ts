import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import { writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { SafeStorageAdapter } from '../../../shared/safe-storage'
import type { ChatCompletedEvent, ChatAttachmentInput } from '../../../shared/types'
import type { ChatEventSink } from './ai-gateway'
import { SettingsService } from '../settings/settings-service'
import { ToolboxStore } from '../chat-store/chat-store'
import type { SecretBox } from '../crypto/secret-box'
import type { ImportService } from '../library/import-service'
import { AiGateway } from './ai-gateway'
import type { ChatImageProcessor } from './chat-attachments'

class FakeSafeStorage implements SafeStorageAdapter {
  isEncryptionAvailable(): boolean {
    return true
  }

  encryptString(plainText: string): Buffer {
    return Buffer.from(plainText, 'utf8').reverse()
  }

  decryptString(encrypted: Buffer): string {
    return Buffer.from(encrypted).reverse().toString('utf8')
  }
}

const box: SecretBox = {
  encrypt: (value) => JSON.stringify(value),
  decrypt: (value) => JSON.parse(value)
}

const imageProcessor: ChatImageProcessor = {
  prepare: () => ({
    data: Buffer.from('jpeg-data'),
    mime: 'image/jpeg',
    width: 320,
    height: 200
  })
}

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])

function textInput(directory: string, content: string): ChatAttachmentInput {
  const path = join(directory, 'notes.md')
  writeFileSync(path, content)
  return { path }
}

function imageInput(directory: string): ChatAttachmentInput {
  const path = join(directory, 'chart.png')
  writeFileSync(path, PNG)
  return { path }
}

function sink(
  done: (event: ChatCompletedEvent) => void,
  fail: (message: string) => void
): ChatEventSink {
  return {
    onDelta: () => undefined,
    onCompleted: done,
    onError: (event) => fail(event.message),
    onStopped: () => fail('已停止'),
    onToolCall: () => undefined,
    onToolResult: () => undefined,
    onToolApprovalRequest: () => undefined,
    onContext: () => undefined,
    onCompaction: () => undefined
  }
}

describe('AiGateway 附件请求', () => {
  let directory: string
  let store: ToolboxStore
  let server: Server
  let baseUrl: string
  let bodies: unknown[]
  let visionFailures: number

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'toolbox-chat-attachments-'))
    store = new ToolboxStore(join(directory, 'toolbox.db'), box)
    bodies = []
    visionFailures = 0
    server = createServer((request: IncomingMessage, response: ServerResponse) => {
      let raw = ''
      request.on('data', (chunk) => {
        raw += chunk
      })
      request.on('end', () => {
        try {
          bodies.push(JSON.parse(raw) as unknown)
        } catch {
          bodies.push(raw)
        }
        if (visionFailures > 0) {
          visionFailures -= 1
          response.writeHead(400, { 'Content-Type': 'application/json' })
          response.end(
            JSON.stringify({
              error: {
                message: 'This model does not support image input',
                type: 'invalid_request_error'
              }
            })
          )
          return
        }
        response.writeHead(200, { 'Content-Type': 'text/event-stream' })
        response.end(
          `data: ${JSON.stringify({
            id: 'chunk',
            object: 'chat.completion.chunk',
            created: 0,
            model: 'test-model',
            choices: [{ index: 0, delta: { content: '收到' }, finish_reason: 'stop' }]
          })}\n\ndata: [DONE]\n\n`
        )
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as AddressInfo
    baseUrl = `http://127.0.0.1:${port}/v1`
  })

  afterEach(async () => {
    store.close()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await rm(directory, { recursive: true, force: true })
  })

  async function gateway(): Promise<AiGateway> {
    const settings = new SettingsService(directory, new FakeSafeStorage())
    await settings.save({
      name: 'test',
      provider: 'custom',
      baseUrl,
      model: 'test-model',
      apiKey: 'sk-test'
    })
    return new AiGateway(
      settings,
      store,
      {} as ImportService,
      join(process.cwd(), 'assets/prompts'),
      {},
      imageProcessor
    )
  }

  it('只有附件没有正文时仍发送，并把文本附件并入模型消息', async () => {
    const conversation = store.createConversation()
    const ai = await gateway()
    const completed = new Promise<ChatCompletedEvent>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('等待回复超时')), 5_000)
      void ai.send(
        {
          conversationId: conversation.id,
          content: '',
          attachments: [textInput(directory, '附件正文')]
        },
        sink(
          (event) => {
            clearTimeout(timer)
            resolve(event)
          },
          (message) => {
            clearTimeout(timer)
            reject(new Error(message))
          }
        )
      )
    })
    const event = await completed
    expect(event.message.content).toContain('收到')
    const messages = store.listMessages(conversation.id)
    expect(messages[0].attachments?.[0]).toMatchObject({ kind: 'text', name: 'notes.md' })
    expect(store.getConversation(conversation.id)?.title).toBe('notes.md')
    expect(JSON.stringify(bodies[0])).toContain('[附件：notes.md]')
    expect(JSON.stringify(bodies[0])).toContain('附件正文')
  })

  it('图片附件以 image_url 发送，并在视觉不支持时无图重试', async () => {
    visionFailures = 1
    const conversation = store.createConversation()
    const ai = await gateway()
    const completed = new Promise<ChatCompletedEvent>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('等待回复超时')), 5_000)
      void ai.send(
        { conversationId: conversation.id, content: '看图', attachments: [imageInput(directory)] },
        sink(
          (event) => {
            clearTimeout(timer)
            resolve(event)
          },
          (message) => {
            clearTimeout(timer)
            reject(new Error(message))
          }
        )
      )
    })
    const event = await completed
    expect(bodies).toHaveLength(2)
    expect(JSON.stringify(bodies[0])).toContain('image_url')
    expect(JSON.stringify(bodies[0])).toContain('data:image/jpeg;base64,')
    expect(JSON.stringify(bodies[1])).not.toContain('image_url')
    expect(event.message.content).toContain('当前模型不支持图片输入')
    expect(event.message.content).toContain('收到')
  })
})
