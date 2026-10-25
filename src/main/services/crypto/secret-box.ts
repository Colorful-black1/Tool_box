export interface SecretPayload {
  account: string
  password: string
  remark: string
}

export interface SecretBox {
  encrypt(payload: SecretPayload): string
  decrypt(cipherBase64: string): SecretPayload
}

/** 用途隔离的文本加密；既有密码载荷接口保持兼容。 */
export interface DraftTextSecretBox {
  encryptText(text: string): string
  decryptText(cipherText: string): string
}
