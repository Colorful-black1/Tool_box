import { afterEach, describe, expect, it, vi } from 'vitest'

import type { SafeStorageAdapter } from '../../../shared/safe-storage'
import type { AiWorldAaKeyRepository } from './key-service'
import { AiWorldAaKeyService } from './key-service'

function fixture(options: { available?: boolean; broken?: boolean } = {}): {
  service: AiWorldAaKeyService
  repository: AiWorldAaKeyRepository
  cipher: () => string | null
} {
  let cipher: string | null = null
  const repository: AiWorldAaKeyRepository = {
    getCipher: () => cipher,
    setCipher: (value) => {
      cipher = value
    }
  }
  const safeStorage: SafeStorageAdapter = {
    isEncryptionAvailable: () => options.available !== false,
    encryptString: (value) => Buffer.from(`encrypted:${value}`, 'utf8'),
    decryptString: (value) => {
      if (options.broken) throw new Error('bad cipher')
      return value.toString('utf8').replace(/^encrypted:/, '')
    }
  }
  return {
    service: new AiWorldAaKeyService(repository, safeStorage),
    repository,
    cipher: () => cipher
  }
}

afterEach(() => vi.restoreAllMocks())

describe('Artificial Analysis Key 存取', () => {
  it('保存后只返回状态，读取时还原明文', () => {
    const f = fixture()
    expect(f.service.saveKey('  test-key-12345678  ')).toEqual({ configured: true })
    expect(f.cipher()).toBeTruthy()
    expect(f.service.status()).toEqual({ configured: true })
    expect(f.service.getKey()).toBe('test-key-12345678')
  })

  it('校验空值、过短和超长 Key', () => {
    const f = fixture()
    expect(() => f.service.saveKey('')).toThrow('不能为空')
    expect(() => f.service.saveKey('short')).toThrow('长度过短')
    expect(() => f.service.saveKey('x'.repeat(300))).toThrow('长度超出上限')
  })

  it('清除后状态变为未配置', () => {
    const f = fixture()
    f.service.saveKey('test-key-12345678')
    expect(f.service.clearKey()).toEqual({ configured: false })
    expect(f.cipher()).toBeNull()
    expect(f.service.status()).toEqual({ configured: false })
  })

  it('解密失败视为未配置，不抛异常', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const f = fixture({ broken: true })
    f.repository.setCipher('broken')
    expect(f.service.getKey()).toBeNull()
    expect(f.service.status()).toEqual({ configured: false })
    expect(warn).toHaveBeenCalledTimes(2)
  })

  it('系统安全存储不可用时拒绝保存', () => {
    const f = fixture({ available: false })
    expect(() => f.service.saveKey('test-key-12345678')).toThrow('系统安全存储不可用')
  })
})
