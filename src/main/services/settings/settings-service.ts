import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { SETTINGS_FILE_NAME } from '../../../shared/constants'
import type { SafeStorageAdapter } from '../../../shared/safe-storage'
import type { AiConfig, AiConfigInput, AiConfigView } from '../../../shared/types'
import { AiGatewayError, normalizeOpenAiBaseUrl } from '../ai-gateway/errors'

interface StoredSettings {
  version: 1
  baseUrl: string
  model: string
  apiKeyCipher: string
}

const EMPTY_SETTINGS: StoredSettings = {
  version: 1,
  baseUrl: '',
  model: '',
  apiKeyCipher: ''
}

export class SettingsService {
  private readonly filePath: string

  constructor(
    directory: string,
    private readonly safeStorage: SafeStorageAdapter
  ) {
    this.filePath = join(directory, SETTINGS_FILE_NAME)
  }

  async getView(): Promise<AiConfigView> {
    const stored = await this.read()
    return {
      baseUrl: stored.baseUrl,
      model: stored.model,
      hasApiKey: stored.apiKeyCipher.length > 0
    }
  }

  async getAiConfig(): Promise<AiConfig> {
    const stored = await this.read()
    if (!stored.baseUrl || !stored.model || !stored.apiKeyCipher) {
      throw new AiGatewayError('请先在设置中配置接口地址、模型名称和 API Key')
    }

    try {
      const apiKey = this.safeStorage.decryptString(
        Buffer.from(stored.apiKeyCipher, 'base64')
      )
      if (!apiKey) throw new Error('解密结果为空')
      return {
        baseUrl: stored.baseUrl,
        model: stored.model,
        apiKey
      }
    } catch (error) {
      throw new AiGatewayError('API Key 解密失败，请重新保存设置', error)
    }
  }

  async save(input: AiConfigInput): Promise<AiConfigView> {
    const baseUrl = normalizeOpenAiBaseUrl(input.baseUrl)
    const model = input.model.trim()
    const apiKey = input.apiKey?.trim() ?? ''

    if (!baseUrl) throw new AiGatewayError('接口地址不能为空')
    if (!model) throw new AiGatewayError('模型名称不能为空')

    const stored = await this.read()
    let apiKeyCipher = stored.apiKeyCipher

    if (apiKey) {
      if (!this.safeStorage.isEncryptionAvailable()) {
        throw new AiGatewayError('当前系统不支持安全加密存储，无法保存 API Key')
      }
      apiKeyCipher = this.safeStorage.encryptString(apiKey).toString('base64')
    } else if (!apiKeyCipher) {
      throw new AiGatewayError('API Key 不能为空')
    }

    const next: StoredSettings = {
      version: 1,
      baseUrl,
      model,
      apiKeyCipher
    }

    await mkdir(dirname(this.filePath), { recursive: true })
    await writeFile(this.filePath, `${JSON.stringify(next, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600
    })

    return this.getView()
  }

  private async read(): Promise<StoredSettings> {
    try {
      const raw = await readFile(this.filePath, 'utf8')
      const parsed = JSON.parse(raw) as Partial<StoredSettings>
      return {
        version: 1,
        baseUrl: typeof parsed.baseUrl === 'string' ? parsed.baseUrl : '',
        model: typeof parsed.model === 'string' ? parsed.model : '',
        apiKeyCipher:
          typeof parsed.apiKeyCipher === 'string' ? parsed.apiKeyCipher : ''
      }
    } catch (error) {
      if (this.isMissingFileError(error)) return EMPTY_SETTINGS
      throw new AiGatewayError('AI 配置文件读取失败', error)
    }
  }

  private isMissingFileError(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: unknown }).code === 'ENOENT'
    )
  }
}
