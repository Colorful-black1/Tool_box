import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { SETTINGS_FILE_NAME } from '../../../shared/constants'
import type { SafeStorageAdapter } from '../../../shared/safe-storage'
import { SettingsService } from './settings-service'

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
      baseUrl: 'https://api.example.com',
      model: ' test-model ',
      apiKey: 'sk-secret-value'
    })

    expect(view).toEqual({
      baseUrl: 'https://api.example.com/v1',
      model: 'test-model',
      hasApiKey: true
    })

    const raw = await readFile(join(directory, SETTINGS_FILE_NAME), 'utf8')
    expect(raw).not.toContain('sk-secret-value')
  })

  it('keeps the existing key when a new key is omitted', async () => {
    const service = new SettingsService(directory, new FakeSafeStorage())
    await service.save({
      baseUrl: 'https://api.example.com',
      model: 'test-model',
      apiKey: 'sk-secret-value'
    })

    const updated = await service.save({
      baseUrl: 'https://api.example.com',
      model: 'updated-model'
    })

    expect(updated.model).toBe('updated-model')
    expect(updated.hasApiKey).toBe(true)

    const config = await service.getAiConfig()
    expect(config.apiKey).toBe('sk-secret-value')
  })

  it('rejects an incomplete first configuration', async () => {
    const service = new SettingsService(directory, new FakeSafeStorage())
    await expect(
      service.save({ baseUrl: 'https://api.example.com', model: 'test-model' })
    ).rejects.toThrow('API Key 不能为空')
  })
})
