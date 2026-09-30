export interface SecretPayload {
  account: string
  password: string
  remark: string
}

export interface SecretBox {
  encrypt(payload: SecretPayload): string
  decrypt(cipherBase64: string): SecretPayload
}
