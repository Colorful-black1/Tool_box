import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import type { SafeStorageAdapter } from '../../../shared/safe-storage'
import type { DraftTextSecretBox, SecretBox } from './secret-box'

interface MasterKeyFile {
  version: 1
  keyCipher: string
}

interface SecretPayload {
  account: string
  password: string
  remark: string
}

const MASTER_KEY_FILE = 'password-master-key.json'

/**
 * 密码箱加解密盒：
 * - 首次使用生成 32 字节随机主密钥；
 * - 主密钥经系统安全区（Electron safeStorage：Windows DPAPI / macOS Keychain / libsecret）
 *   加密后落盘，数据整库拷走也无法解密；
 * - 运行期解密缓存，用于敏感字段 AES-256-GCM 加解密。
 */
export class SafeStorageSecretBox implements SecretBox, DraftTextSecretBox {
  private cachedKey: Buffer | null = null

  constructor(
    private readonly directory: string,
    private readonly safeStorage: SafeStorageAdapter
  ) {}

  encrypt(payload: SecretPayload): string {
    const key = this.masterKey()
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', key, iv)
    const plaintext = Buffer.from(JSON.stringify(payload), 'utf8')
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()])

    return JSON.stringify({
      v: 1,
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      data: encrypted.toString('base64')
    })
  }

  decrypt(cipherText: string): SecretPayload {
    const envelope = JSON.parse(cipherText) as {
      v: number
      iv: string
      tag: string
      data: string
    }
    if (envelope.v !== 1 || !envelope.iv || !envelope.tag || !envelope.data) {
      throw new Error('密文格式无效')
    }

    const decipher = createDecipheriv(
      'aes-256-gcm',
      this.masterKey(),
      Buffer.from(envelope.iv, 'base64')
    )
    decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'))
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(envelope.data, 'base64')),
      decipher.final()
    ])
    return JSON.parse(plaintext.toString('utf8')) as SecretPayload
  }

  encryptText(text: string): string {
    if (!this.safeStorage.isEncryptionAvailable()) throw new Error('系统安全存储不可用')
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', this.masterKey('create-safe'), iv)
    cipher.setAAD(Buffer.from('toolbox:agent-drafts:v1'))
    const data = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()])
    return JSON.stringify({
      v: 2,
      purpose: 'agent-drafts',
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      data: data.toString('base64')
    })
  }

  decryptText(cipherText: string): string {
    if (!this.safeStorage.isEncryptionAvailable()) throw new Error('系统安全存储不可用')
    const envelope = JSON.parse(cipherText) as Record<string, unknown>
    if (
      envelope.v !== 2 ||
      envelope.purpose !== 'agent-drafts' ||
      typeof envelope.iv !== 'string' ||
      typeof envelope.tag !== 'string' ||
      typeof envelope.data !== 'string'
    )
      throw new Error('草稿密文格式无效')
    const decipher = createDecipheriv(
      'aes-256-gcm',
      this.masterKey('existing'),
      Buffer.from(envelope.iv, 'base64')
    )
    decipher.setAAD(Buffer.from('toolbox:agent-drafts:v1'))
    decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'))
    return Buffer.concat([
      decipher.update(Buffer.from(envelope.data, 'base64')),
      decipher.final()
    ]).toString('utf8')
  }

  private masterKey(mode: 'legacy' | 'create-safe' | 'existing' = 'legacy'): Buffer {
    if (this.cachedKey) return this.cachedKey

    const filePath = join(this.directory, MASTER_KEY_FILE)
    let file: MasterKeyFile | null = null
    try {
      const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as MasterKeyFile
      if (parsed?.version === 1 && parsed.keyCipher) file = parsed
    } catch (error) {
      // 草稿路径不能把损坏、无法读取或缺失的旧密钥当作首次创建。
      if (
        mode !== 'legacy' &&
        (mode === 'existing' || (error as NodeJS.ErrnoException).code !== 'ENOENT')
      )
        throw new Error('主密钥不可读取', { cause: error })
      file = null
    }

    if (!file && mode !== 'legacy') {
      // create-safe 只允许文件确实不存在；格式无效的文件必须原样保留。
      try {
        readFileSync(filePath)
        throw new Error('主密钥格式无效')
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
    }

    if (!file) {
      if (!this.safeStorage.isEncryptionAvailable()) {
        throw new Error('当前系统不支持安全加密存储，无法启用密码箱')
      }
      const raw = randomBytes(32)
      const stored: MasterKeyFile = {
        version: 1,
        keyCipher: this.safeStorage.encryptString(raw.toString('base64')).toString('base64')
      }
      mkdirSync(dirname(filePath), { recursive: true })
      writeFileSync(filePath, JSON.stringify(stored), {
        mode: 0o600,
        ...(mode === 'create-safe' ? { flag: 'wx' } : {})
      })
      this.cachedKey = raw
      return raw
    }

    const key = Buffer.from(
      this.safeStorage.decryptString(Buffer.from(file.keyCipher, 'base64')),
      'base64'
    )
    if (key.length !== 32) throw new Error('主密钥损坏，无法解密密码箱')
    this.cachedKey = key
    return key
  }
}
