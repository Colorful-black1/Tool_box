import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SafeStorageSecretBox } from './safe-storage-secret-box'

const directories: string[] = []
const safe = {
  isEncryptionAvailable: () => true,
  encryptString: (value: string) => Buffer.from(value),
  decryptString: (value: Buffer) => value.toString()
}
function fixture(): { directory: string; box: SafeStorageSecretBox } {
  const directory = mkdtempSync(join(tmpdir(), 'toolbox-crypto-test-'))
  directories.push(directory)
  return { directory, box: new SafeStorageSecretBox(directory, safe) }
}
afterEach(() => {
  for (const directory of directories.splice(0)) {
    if (!resolve(directory).startsWith(resolve(tmpdir()) + requireSeparator()))
      throw new Error('清理路径越界')
    rmSync(directory, { recursive: true, force: true })
  }
})
function requireSeparator(): string {
  return process.platform === 'win32' ? '\\' : '/'
}

describe('草稿文本加密与旧密码兼容', () => {
  it('旧 v1 密码和新 v2 用途密文可跨实例读取，随机 IV 不重复', () => {
    const { box, directory } = fixture()
    const payload = { account: 'fixture', password: 'fixture-password', remark: '' }
    const password = box.encrypt(payload)
    const first = box.encryptText('  未发送\n')
    const second = box.encryptText('  未发送\n')
    const reopened = new SafeStorageSecretBox(directory, safe)
    expect(JSON.parse(password).v).toBe(1)
    expect(reopened.decrypt(password)).toEqual(payload)
    expect(reopened.decryptText(first)).toBe('  未发送\n')
    expect(first).not.toBe(second)
    expect(first).not.toContain('未发送')
    expect(() => reopened.decryptText(password)).toThrow()
    const changed = JSON.parse(first)
    changed.purpose = 'password'
    expect(() => reopened.decryptText(JSON.stringify(changed))).toThrow()
  })
  it('损坏或缺失主密钥的读取不创建、不替换文件', () => {
    const { directory, box } = fixture()
    const cipher = box.encryptText('fixture')
    const key = join(directory, 'password-master-key.json')
    writeFileSync(key, '{broken')
    const broken = new SafeStorageSecretBox(directory, safe)
    expect(() => broken.decryptText(cipher)).toThrow()
    expect(() => broken.encryptText('new')).toThrow()
    expect(readFileSync(key, 'utf8')).toBe('{broken')
    rmSync(key)
    expect(() => new SafeStorageSecretBox(directory, safe).decryptText(cipher)).toThrow()
  })
  it('系统安全存储不可用时不降级为明文', () => {
    const { directory } = fixture()
    const box = new SafeStorageSecretBox(directory, { ...safe, isEncryptionAvailable: () => false })
    expect(() => box.encryptText('fixture')).toThrow()
  })
})
