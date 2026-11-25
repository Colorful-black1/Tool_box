import type { SafeStorageAdapter } from '../../../shared/safe-storage'
import type { AiWorldAaKeyStatus } from '../../../shared/ai-world-aa'
import { AiWorldAaError } from './errors'

export interface AiWorldAaKeyRepository {
  getCipher(): string | null
  setCipher(cipher: string | null): void
}

const MAX_KEY_LENGTH = 256
const MIN_KEY_LENGTH = 8

/**
 * Artificial Analysis API Key 存取：
 * - 明文只在主进程使用，落盘前经系统安全存储（Windows DPAPI）加密；
 * - 对外只返回 configured 布尔值，绝不回传明文；
 * - 解密失败视为未配置，提示重新填写，不把异常细节传给渲染层。
 */
export class AiWorldAaKeyService {
  constructor(
    private readonly repository: AiWorldAaKeyRepository,
    private readonly safeStorage: SafeStorageAdapter
  ) {}

  status(): AiWorldAaKeyStatus {
    return { configured: this.getKey() != null }
  }

  getKey(): string | null {
    const cipher = this.repository.getCipher()
    if (!cipher) return null
    try {
      const key = this.safeStorage.decryptString(Buffer.from(cipher, 'base64')).trim()
      return key || null
    } catch {
      console.warn('[AiWorldAa] API Key 解密失败，请重新配置')
      return null
    }
  }

  saveKey(input: unknown): AiWorldAaKeyStatus {
    if (typeof input !== 'string') throw new AiWorldAaError('API Key 格式不正确')
    const key = input.trim()
    if (!key) throw new AiWorldAaError('API Key 不能为空')
    if (key.length < MIN_KEY_LENGTH) throw new AiWorldAaError('API Key 长度过短')
    if (key.length > MAX_KEY_LENGTH) throw new AiWorldAaError('API Key 长度超出上限')
    if (!this.safeStorage.isEncryptionAvailable()) {
      throw new AiWorldAaError('系统安全存储不可用，无法保存 API Key')
    }
    try {
      this.repository.setCipher(this.safeStorage.encryptString(key).toString('base64'))
    } catch {
      throw new AiWorldAaError('API Key 保存失败，请检查系统安全存储后重试')
    }
    return { configured: true }
  }

  clearKey(): AiWorldAaKeyStatus {
    this.repository.setCipher(null)
    return { configured: false }
  }
}
