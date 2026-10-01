import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { SETTINGS_FILE_NAME } from '../../../shared/constants'
import type { SafeStorageAdapter } from '../../../shared/safe-storage'
import { SettingsService, normalizeStoredSettings } from './settings-service'

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

describe('SettingsService', () => {
  let directory: string

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'tool-box-settings-'))
  })

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  it('normalizes the base URL and encrypts the API key', async () => {
    const service = new SettingsService(directory, new FakeSafeStorage())
    const view = await service.save({
      name: '主力',
      provider: 'custom',
      baseUrl: 'https://api.example.com',
      model: ' test-model ',
      apiKey: 'sk-secret-value'
    })

    expect(view.profiles).toEqual([
      {
        id: view.profiles[0].id,
        name: '主力',
        provider: 'custom',
        baseUrl: 'https://api.example.com/v1',
        model: 'test-model',
        hasApiKey: true
      }
    ])
    // 首个档案自动启用
    expect(view.activeId).toBe(view.profiles[0].id)

    const raw = await readFile(join(directory, SETTINGS_FILE_NAME), 'utf8')
    expect(raw).not.toContain('sk-secret-value')
  })

  it('keeps the existing key when a new key is omitted', async () => {
    const service = new SettingsService(directory, new FakeSafeStorage())
    const created = await service.save({
      name: '主力',
      provider: 'custom',
      baseUrl: 'https://api.example.com',
      model: 'test-model',
      apiKey: 'sk-secret-value'
    })
    const id = created.profiles[0].id

    const updated = await service.save({
      id,
      name: '主力',
      provider: 'custom',
      baseUrl: 'https://api.example.com',
      model: 'updated-model'
    })

    expect(updated.profiles[0].model).toBe('updated-model')
    expect(updated.profiles[0].hasApiKey).toBe(true)

    const config = await service.getAiConfig()
    expect(config.apiKey).toBe('sk-secret-value')
  })

  it('rejects a new profile without any API key', async () => {
    const service = new SettingsService(directory, new FakeSafeStorage())
    await expect(
      service.save({
        name: '空 Key',
        provider: 'custom',
        baseUrl: 'https://api.example.com',
        model: 'test-model'
      })
    ).rejects.toThrow('API Key 不能为空')
  })

  it('manages multiple profiles and switches the active one', async () => {
    const service = new SettingsService(directory, new FakeSafeStorage())
    const first = await service.save({
      name: 'GLM',
      provider: 'glm',
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
      model: 'glm-5.3',
      apiKey: 'sk-glm'
    })
    const second = await service.save({
      name: 'DeepSeek',
      provider: 'deepseek',
      baseUrl: 'https://api.deepseek.com/v1',
      model: 'deepseek-v4-pro',
      apiKey: 'sk-deepseek'
    })

    expect(second.profiles).toHaveLength(2)
    // 已有启用项时不会被新档案顶替
    expect(second.activeId).toBe(first.profiles[0].id)
    expect((await service.getAiConfig()).apiKey).toBe('sk-glm')

    const activated = await service.activate(second.profiles[1].id)
    expect(activated.activeId).toBe(second.profiles[1].id)
    expect((await service.getAiConfig()).apiKey).toBe('sk-deepseek')
  })

  it('reactivates a neighbour when the active profile is removed', async () => {
    const service = new SettingsService(directory, new FakeSafeStorage())
    const created = await service.save({
      name: 'A',
      provider: 'custom',
      baseUrl: 'https://a.example.com',
      model: 'a-model',
      apiKey: 'sk-a'
    })
    const withB = await service.save({
      name: 'B',
      provider: 'custom',
      baseUrl: 'https://b.example.com',
      model: 'b-model',
      apiKey: 'sk-b'
    })
    const bId = withB.profiles[1].id

    const after = await service.remove(created.profiles[0].id)
    expect(after.profiles).toHaveLength(1)
    expect(after.activeId).toBe(bId)
  })

  it('reports a missing active profile when everything is removed', async () => {
    const service = new SettingsService(directory, new FakeSafeStorage())
    await service.save({
      name: 'A',
      provider: 'custom',
      baseUrl: 'https://a.example.com',
      model: 'a-model',
      apiKey: 'sk-a'
    })
    const view = await service.getView()
    await service.remove(view.profiles[0].id)

    expect((await service.getView()).profiles).toHaveLength(0)
    await expect(service.getAiConfig()).rejects.toThrow('尚未启用任何 AI 配置')
  })

  it('migrates the legacy single-config file without losing the key', async () => {
    const service = new SettingsService(directory, new FakeSafeStorage())
    const cipher = new FakeSafeStorage().encryptString('sk-legacy').toString('base64')
    await writeFile(
      join(directory, SETTINGS_FILE_NAME),
      JSON.stringify({
        version: 1,
        baseUrl: 'https://api.deepseek.com/v1',
        model: 'deepseek-v4-pro',
        apiKeyCipher: cipher
      }),
      'utf8'
    )

    const view = await service.getView()
    expect(view.profiles).toHaveLength(1)
    expect(view.profiles[0].provider).toBe('deepseek')
    expect(view.profiles[0].name).toBe('DeepSeek')
    expect(view.activeId).toBe(view.profiles[0].id)
    expect((await service.getAiConfig()).apiKey).toBe('sk-legacy')
  })

  it('falls back to a builtin model list when the provider endpoint fails', async () => {
    const service = new SettingsService(directory, new FakeSafeStorage())
    const result = await service.fetchModels({
      provider: 'deepseek',
      baseUrl: 'http://127.0.0.1:9/v1',
      apiKey: 'sk-unreachable'
    })

    expect(result.source).toBe('preset')
    expect(result.models).toContain('deepseek-v4-pro')
    expect(result.message).toBeTruthy()
  })

  it('surfaces the error for custom providers without a builtin list', async () => {
    const service = new SettingsService(directory, new FakeSafeStorage())
    await expect(
      service.fetchModels({
        provider: 'custom',
        baseUrl: 'http://127.0.0.1:9/v1',
        apiKey: 'sk-unreachable'
      })
    ).rejects.toThrow()
  })

  it('requires an API key before fetching models', async () => {
    const service = new SettingsService(directory, new FakeSafeStorage())
    await expect(
      service.fetchModels({ provider: 'deepseek', baseUrl: 'https://api.deepseek.com/v1' })
    ).rejects.toThrow('请先填写或保存 API Key')
  })
})

describe('normalizeStoredSettings', () => {
  it('returns an empty config for unusable payloads', () => {
    expect(normalizeStoredSettings(null)).toEqual({ version: 2, activeId: '', profiles: [] })
    expect(normalizeStoredSettings('nope')).toEqual({
      version: 2,
      activeId: '',
      profiles: []
    })
    expect(normalizeStoredSettings({ version: 1, baseUrl: '', model: '', apiKeyCipher: '' }))
      .toEqual({ version: 2, activeId: '', profiles: [] })
  })

  it('repairs a dangling activeId and infers missing providers', () => {
    const result = normalizeStoredSettings({
      version: 2,
      activeId: 'missing',
      profiles: [{ id: 'p1', baseUrl: 'https://api.xiaomimimo.com/v1', model: 'mimo-v2.5' }]
    })

    expect(result.activeId).toBe('p1')
    expect(result.profiles[0].provider).toBe('mimo')
    expect(result.profiles[0].name).toBe('小米 MiMo')
  })

  it('treats an unknown base URL as a custom provider', () => {
    const result = normalizeStoredSettings({
      version: 2,
      activeId: '',
      profiles: [{ id: 'p1', provider: 'nope', baseUrl: 'https://self.host/v1', model: 'x' }]
    })

    expect(result.profiles[0].provider).toBe('custom')
  })
})
