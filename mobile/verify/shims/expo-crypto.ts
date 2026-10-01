/**
 * 验证用 shim：用 Node 的 WebCrypto 顶替 expo-crypto。
 *
 * expo-crypto 的 AES-GCM 本身就是按 WebCrypto 语义实现的（Web 平台直接用 SubtleCrypto），
 * 因此这个 shim 与真机行为等价；它只用于在 Node 里验证 secret-box.ts 的逻辑。
 * 注意：shim 里的 key 长度检查比原生宽松，不代表原生实现没有该校验。
 */
import { webcrypto } from 'node:crypto'

const subtle = webcrypto.subtle as unknown as SubtleCrypto

const KEY_SIZE_BITS = 256
const IV_BYTE_LENGTH = 12
const TAG_BYTE_LENGTH = 16

export function getRandomBytes(byteCount: number): Uint8Array {
  const bytes = new Uint8Array(byteCount)
  webcrypto.getRandomValues(bytes)
  return bytes
}

class EncryptionKey {
  constructor(private readonly raw: Uint8Array) {}

  static async generate(): Promise<EncryptionKey> {
    return new EncryptionKey(getRandomBytes(KEY_SIZE_BITS / 8))
  }

  static async import(bytes: Uint8Array): Promise<EncryptionKey> {
    if (bytes.length !== KEY_SIZE_BITS / 8) {
      throw new Error(`invalid key size: ${bytes.length}`)
    }
    return new EncryptionKey(bytes)
  }

  size = KEY_SIZE_BITS

  async bytes(): Promise<Uint8Array> {
    return this.raw
  }

  async encoded(encoding: 'hex' | 'base64'): Promise<string> {
    return Buffer.from(this.raw).toString(encoding)
  }

  /** 供 shim 内部使用：转成 WebCrypto 的 CryptoKey */
  async toCryptoKey(): Promise<CryptoKey> {
    return subtle.importKey('raw', this.raw as unknown as BufferSource, 'AES-GCM', false, [
      'encrypt',
      'decrypt'
    ])
  }
}

class SealedData {
  constructor(
    readonly ivBytes: Uint8Array,
    readonly ciphertextBytes: Uint8Array,
    readonly tagBytes: Uint8Array
  ) {}

  static fromParts(iv: Uint8Array, ciphertext: Uint8Array, tag: Uint8Array): SealedData {
    return new SealedData(iv, ciphertext, tag)
  }

  async iv(encoding?: 'bytes' | 'base64'): Promise<Uint8Array | string> {
    return encoding === 'base64' ? Buffer.from(this.ivBytes).toString('base64') : this.ivBytes
  }

  async tag(encoding?: 'bytes' | 'base64'): Promise<Uint8Array | string> {
    return encoding === 'base64' ? Buffer.from(this.tagBytes).toString('base64') : this.tagBytes
  }

  async ciphertext(options?: {
    includeTag?: boolean
    encoding?: 'bytes' | 'base64'
  }): Promise<Uint8Array | string> {
    const data = options?.includeTag
      ? Buffer.concat([Buffer.from(this.ciphertextBytes), Buffer.from(this.tagBytes)])
      : Buffer.from(this.ciphertextBytes)
    return options?.encoding === 'base64' ? data.toString('base64') : new Uint8Array(data)
  }

  get ivSize(): number {
    return this.ivBytes.length
  }

  get tagSize(): number {
    return this.tagBytes.length
  }
}

export async function aesEncryptAsync(
  plaintext: Uint8Array,
  key: EncryptionKey
): Promise<SealedData> {
  const iv = getRandomBytes(IV_BYTE_LENGTH)
  const cryptoKey = await key.toCryptoKey()
  const combined = new Uint8Array(
    await subtle.encrypt(
      { name: 'AES-GCM', iv: iv as unknown as BufferSource, tagLength: TAG_BYTE_LENGTH * 8 },
      cryptoKey,
      plaintext as unknown as BufferSource
    )
  )
  // WebCrypto 输出是 ciphertext || tag，需要拆开
  const ciphertext = combined.slice(0, combined.length - TAG_BYTE_LENGTH)
  const tag = combined.slice(combined.length - TAG_BYTE_LENGTH)
  return new SealedData(iv, ciphertext, tag)
}

export async function aesDecryptAsync(
  sealed: SealedData,
  key: EncryptionKey,
  options?: { output?: 'bytes' | 'base64' }
): Promise<Uint8Array | string> {
  const cryptoKey = await key.toCryptoKey()
  const combined = Buffer.concat([
    Buffer.from(sealed.ciphertextBytes),
    Buffer.from(sealed.tagBytes)
  ])
  const plain = new Uint8Array(
    await subtle.decrypt(
      { name: 'AES-GCM', iv: sealed.ivBytes as unknown as BufferSource },
      cryptoKey,
      combined as unknown as BufferSource
    )
  )
  return options?.output === 'base64' ? Buffer.from(plain).toString('base64') : plain
}

export const AESEncryptionKey = EncryptionKey
export const AESSealedData = SealedData
export const KEY_BYTE_LENGTH = KEY_SIZE_BITS / 8