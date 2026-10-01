import * as Crypto from 'expo-crypto'
import { AESEncryptionKey, AESSealedData } from 'expo-crypto'
import * as SecureStore from 'expo-secure-store'

import { MASTER_KEY_STORE_KEY } from './constants'
import type { SecretPayload } from './secret-envelope'
import { bytesToPayload, packEnvelope, payloadToBytes, unpackEnvelope } from './secret-envelope'

/**
 * 密码箱加解密盒。
 *
 * 与桌面端 `SafeStorageSecretBox` 同构：
 * - 首次使用生成 32 字节随机主密钥（AES-256）；
 * - 主密钥交给系统钥匙串（iOS Keychain / Android Keystore 加密的 SharedPreferences）
 *   保存，不落明文；
 * - 敏感字段 AES-256-GCM 加密，落库信封格式与桌面端一致。
 *
 * 差异：桌面端用 Electron safeStorage（Windows DPAPI），手机端用 expo-secure-store。
 * 两者都把主密钥绑在设备上，因此**手机端与桌面端的密码箱密文不互通**。
 *
 * 注意：本类依赖原生模块，无法在 vitest 中测试；信封格式由 secret-envelope.test.ts
 * 与桌面端产出的样本做交叉验证，算法正确性需真机验收。
 */

const MASTER_KEY_BYTE_LENGTH = 32

export interface SecretBox {
  encrypt(payload: SecretPayload): Promise<string>
  decrypt(cipherText: string): Promise<SecretPayload>
}

/** 任意字符串的加解密（AI API Key 用）；与密码箱负载形状无关，故单独一个接口 */
export interface SecretStringBox {
  encryptText(plainText: string): Promise<string>
  decryptText(cipherText: string): Promise<string>
  /** 设备是否支持安全存储；不支持时保存密钥应直接报错 */
  assertAvailable(): Promise<void>
}

/** expo-crypto 的取值方法返回 Uint8Array | string，这里统一收敛成字节数组 */
function asBytes(value: Uint8Array | string): Uint8Array {
  return typeof value === 'string' ? base64ToBytes(value) : value
}

export class SecureStoreSecretBox implements SecretBox, SecretStringBox {
  private cachedKey: AESEncryptionKey | null = null

  /**
   * @param storeKey 钥匙串里的键名。密码箱与 AI 配置各用一把，生命周期互不影响：
   *   密码箱主密钥丢失会导致密码永久不可解，不该让「删除 AI 配置」牵连它。
   */
  constructor(private readonly storeKey: string = MASTER_KEY_STORE_KEY) {}

  async encrypt(payload: SecretPayload): Promise<string> {
    const key = await this.masterKey()
    // nonce 由 expo-crypto 生成（默认 12 字节），长度与桌面端一致
    const sealed = await Crypto.aesEncryptAsync(payloadToBytes(payload), key)

    return packEnvelope({
      iv: asBytes(await sealed.iv('bytes')),
      tag: asBytes(await sealed.tag('bytes')),
      data: asBytes(await sealed.ciphertext({ encoding: 'bytes' }))
    })
  }

  async decrypt(cipherText: string): Promise<SecretPayload> {
    const { iv, tag, data } = unpackEnvelope(cipherText)
    const key = await this.masterKey()
    const sealed = AESSealedData.fromParts(iv, data, tag)
    const opened = await Crypto.aesDecryptAsync(sealed, key, { output: 'bytes' })
    return bytesToPayload(typeof opened === 'string' ? base64ToBytes(opened) : opened)
  }

  /** 主密钥：优先读钥匙串，没有则生成并写入。运行期缓存，避免每次加解密都访问钥匙串 */
  private async masterKey(): Promise<AESEncryptionKey> {
    if (this.cachedKey) return this.cachedKey

    const stored = await SecureStore.getItemAsync(this.storeKey)
    if (stored) {
      const raw = base64ToBytes(stored)
      if (raw.length !== MASTER_KEY_BYTE_LENGTH) throw new Error('主密钥损坏，无法解密密码箱')
      this.cachedKey = await AESEncryptionKey.import(raw)
      return this.cachedKey
    }

    const key = await AESEncryptionKey.generate()
    const raw = await key.bytes()
    await SecureStore.setItemAsync(this.storeKey, bytesToBase64(raw), {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY
    })
    this.cachedKey = key
    return key
  }

  /** 把任意字符串按 UTF-8 加密；信封格式与密码箱一致 */
  async encryptText(plainText: string): Promise<string> {
    const key = await this.masterKey()
    const sealed = await Crypto.aesEncryptAsync(new TextEncoder().encode(plainText), key)

    return packEnvelope({
      iv: asBytes(await sealed.iv('bytes')),
      tag: asBytes(await sealed.tag('bytes')),
      data: asBytes(await sealed.ciphertext({ encoding: 'bytes' }))
    })
  }

  async decryptText(cipherText: string): Promise<string> {
    const { iv, tag, data } = unpackEnvelope(cipherText)
    const opened = await Crypto.aesDecryptAsync(
      AESSealedData.fromParts(iv, data, tag),
      await this.masterKey(),
      { output: 'bytes' }
    )
    return new TextDecoder().decode(typeof opened === 'string' ? base64ToBytes(opened) : opened)
  }

  /**
   * 设备是否支持安全存储。
   * 没有 keychain / keystore 时写入会失败，所以保存密钥前先探一次，
   * 给出可读提示，而不是等到写入时才报错。
   */
  async assertAvailable(): Promise<void> {
    try {
      await this.masterKey()
    } catch {
      throw new Error('当前设备不支持安全加密存储，无法保存密钥')
    }
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}