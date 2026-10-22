import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { IncomingHttpHeaders, Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { SafeStorageAdapter } from '../../../shared/safe-storage'
import type { ToolboxStore } from '../chat-store/chat-store'
import type { ImportService } from '../library/import-service'
import { SettingsService } from '../settings/settings-service'
import { AiGateway } from './ai-gateway'

/**
 * 集成测试：用本地 mock 服务验证 AiGateway 真的把供应商要求的请求头发了出去。
 * 纯函数单测只能证明 buildProviderHeaders 正确，这里补上「LangChain 是否真的转发」这一环。
 */
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

/** complete() 不触碰数据层，这里只提供类型占位 */
const storeStub = {} as ToolboxStore
const importServiceStub = {} as ImportService

describe('AiGateway provider headers', () => {
  let directory: string
  let server: Server
  let baseUrl: string
  let received: IncomingHttpHeaders[]

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'tool-box-headers-'))
    received = []
    server = createServer((request, response) => {
      received.push(request.headers)
      response.writeHead(200, { 'Content-Type': 'text/event-stream' })
      response.end(
        ['po', 'ng'].map((content) => `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content } }] })}\n\n`).join('') + 'data: [DONE]\n\n'
      )
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as AddressInfo
    baseUrl = `http://127.0.0.1:${port}/v1`
  })

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await rm(directory, { recursive: true, force: true })
  })

  it('sends x-opencode-session and a custom user agent to OpenCode Go', async () => {
    const settings = new SettingsService(directory, new FakeSafeStorage())
    await settings.save({
      name: 'Go',
      provider: 'opencode-go',
      baseUrl,
      model: 'mimo-v2.5',
      apiKey: 'sk-test'
    })

    const gateway = new AiGateway(settings, storeStub, importServiceStub, '')
    const reply = await gateway.complete('system', 'ping')

    expect(reply).toBe('pong')
    expect(received).toHaveLength(1)
    expect(received[0]['x-opencode-session']).toBeTruthy()
    expect(received[0]['user-agent']).toBe('tool-box-electron')
    expect(received[0].authorization).toBe('Bearer sk-test')
  })

  it('does not add provider specific headers for plain custom endpoints', async () => {
    const settings = new SettingsService(directory, new FakeSafeStorage())
    await settings.save({
      name: 'Self hosted',
      provider: 'custom',
      baseUrl,
      model: 'my-model',
      apiKey: 'sk-test'
    })

    const gateway = new AiGateway(settings, storeStub, importServiceStub, '')
    await gateway.complete('system', 'ping')

    expect(received).toHaveLength(1)
    expect(received[0]['x-opencode-session']).toBeUndefined()
  })

  it('真实传输在完成前逐片回调，并支持取消与输出上限', async () => {
    const settings = new SettingsService(directory, new FakeSafeStorage())
    await settings.save({ name: '合成流', provider: 'custom', baseUrl, model: 'test', apiKey: 'sk-test' })
    const gateway = new AiGateway(settings, storeStub, importServiceStub, '')
    const deltas: string[] = []
    let completed = false
    await gateway.complete('system', 'ping', { onDelta: (delta) => {
      expect(completed).toBe(false)
      deltas.push(delta)
    } }).then(() => { completed = true })
    expect(deltas).toEqual(['po', 'ng'])
    const controller = new AbortController()
    await expect(gateway.complete('system', 'ping', { signal: controller.signal, onDelta: () => controller.abort() }))
      .rejects.toMatchObject({ name: 'AbortError' })
    await expect(gateway.complete('system', 'ping', { maxOutputChars: 1 })).rejects.toThrow('过长')
  })
})
