/**
 * 密码箱密文信封 —— 纯函数部分。
 *
 * 格式与桌面端 `SafeStorageSecretBox` 完全一致：
 *   { "v": 1, "iv": <base64>, "tag": <base64>, "data": <base64> }
 * 其中 data 是 AES-256-GCM 密文（不含 tag），tag 是 16 字节认证标签。
 *
 * 之所以把打包/解包拆成纯函数：expo-crypto 与 expo-secure-store 是原生模块，
 * 在 vitest（node 环境）里跑不起来，但信封格式必须能被自动化验证，
 * 否则「两端密文互通」只是口头承诺。
 */

export interface SecretEnvelope {
  v: 1
  iv: string
  tag: string
  data: string
}

export interface SecretPayload {
  account: string
  password: string
  remark: string
}

export const ENVELOPE_VERSION = 1

/** AES-GCM 推荐 12 字节 IV，与桌面端一致 */
export const IV_BYTE_LENGTH = 12
/** GCM 认证标签长度 */
export const TAG_BYTE_LENGTH = 16

/** 字节数组 → base64（优先用全局 btoa，RN 与 Node 均可用） */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

/** base64 → 字节数组 */
export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/** 明文 JSON → UTF-8 字节 */
export function payloadToBytes(payload: SecretPayload): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(payload))
}

/** UTF-8 字节 → 明文对象 */
export function bytesToPayload(bytes: Uint8Array): SecretPayload {
  return JSON.parse(new TextDecoder().decode(bytes)) as SecretPayload
}

/** 组装信封。iv / data / tag 均为字节数组 */
export function packEnvelope(input: {
  iv: Uint8Array
  tag: Uint8Array
  data: Uint8Array
}): string {
  return JSON.stringify({
    v: ENVELOPE_VERSION,
    iv: bytesToBase64(input.iv),
    tag: bytesToBase64(input.tag),
    data: bytesToBase64(input.data)
  })
}

/**
 * 解析信封，任何字段缺失或版本不符都抛错。
 * 与桌面端一致：宁可报错也不返回半成品，避免把损坏数据当成空密码。
 */
export function unpackEnvelope(cipherText: string): {
  iv: Uint8Array
  tag: Uint8Array
  data: Uint8Array
} {
  const envelope = JSON.parse(cipherText) as Partial<SecretEnvelope>
  if (
    envelope.v !== ENVELOPE_VERSION ||
    typeof envelope.iv !== 'string' ||
    typeof envelope.tag !== 'string' ||
    typeof envelope.data !== 'string' ||
    !envelope.iv ||
    !envelope.tag ||
    !envelope.data
  ) {
    throw new Error('密文格式无效')
  }
  return {
    iv: base64ToBytes(envelope.iv),
    tag: base64ToBytes(envelope.tag),
    data: base64ToBytes(envelope.data)
  }
}

/** 读出信封版本，供诊断用（不抛错） */
export function envelopeVersion(cipherText: string): number | null {
  try {
    const envelope = JSON.parse(cipherText) as Partial<SecretEnvelope>
    return typeof envelope.v === 'number' ? envelope.v : null
  } catch {
    return null
  }
}