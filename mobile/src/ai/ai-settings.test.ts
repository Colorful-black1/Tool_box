import { describe, expect, it } from 'vitest'

import { AI_SETTINGS_KV_KEY, AiSettingsService, normalizeStoredSettings } from './ai-settings'
import type { KvStore, StoredAiSettings } from './ai-settings'
import type { SecretStringBox } from '../data/secret-box'

/** 内存版 kv，直接存 JSON 字符串，能验证「密文真的落库了」 */
class FakeKv implements KvStore {
  readonly rows = new Map<string, string>()

  async kvGet(key: string): Promise<string | null> {
    return this.rows.get(key) ?? null
  }

  async kvSet(key: string, value: string): Promise<void> {
    this.rows.set(key, value)
  }

  /** 直接读落盘内容 */
  raw(key = AI_SETTINGS_KV_KEY): string | null {
    return this.rows.get(key) ?? null
  }
}

/**
 * 假密钥盒：base64 编码模拟密文。
 * 必须真的遮蔽明文 —— 否则「密文未落明文」的断言测不出问题。
 */
class FakeSecretBox implements SecretStringBox {
  available = true
  failDecrypt = false

  async assertAvailable(): Promise<void> {
    if (!this.available) throw new Error('当前设备不支持安全加密存储，无法保存密钥')
  }

  async encryptText(plainText: string): Promise<string> {
    return `CIPHER::${btoa(unescape(encodeURIComponent(plainText)))}`
  }

  async decryptText(cipherText: string): Promise<string> {
    if (this.failDecrypt) throw new Error('boom')
    return decodeURIComponent(escape(atob(cipherText.replace('CIPHER::', ''))))
  }
}

function makeService(): { service: AiSettingsService; kv: FakeKv; box: FakeSecretBox } {
  const kv = new FakeKv()
  const box = new FakeSecretBox()
  let counter = 0
  const service = new AiSettingsService(kv, box, () => `id-${(counter += 1)}`)
  return { service, kv, box }
}

const BASE = {
  name: '主力',
  provider: 'deepseek' as const,
  baseUrl: 'https://api.deepseek.com/v1',
  model: 'deepseek-v4-pro',
  apiKey: 'sk-secret'
}

describe('AiSettingsService.save', () => {
  it('保存后脱敏视图不暴露 Key', async () => {
    const { service } = makeService()
    const view = await service.save(BASE)

    expect(view.profiles).toHaveLength(1)
    expect(view.profiles[0]?.hasApiKey).toBe(true)
    expect(JSON.stringify(view)).not.toContain('sk-secret')
  })

  // 关键回归：API Key 绝不能明文落库
  it('落盘内容是密文而不是明文 Key', async () => {
    const { service, kv } = makeService()
    await service.save(BASE)

    const raw = kv.raw()
    expect(raw).toContain('CIPHER::')
    expect(raw).not.toContain('sk-secret')
  })

  it('首个档案自动启用', async () => {
    const { service } = makeService()
    const view = await service.save(BASE)
    expect(view.activeId).toBe(view.profiles[0]?.id)
  })

  it('「显示实时模型列表」按档案保存，留空时保持原值', async () => {
    const { service } = makeService()
    const created = await service.save({ ...BASE, showRemoteModels: false })
    const id = created.profiles[0]?.id
    expect(created.profiles[0]?.showRemoteModels).toBe(false)

    // 不带该字段再次保存：保持 false
    const updated = await service.save({ ...BASE, id })
    expect(updated.profiles[0]?.showRemoteModels).toBe(false)
  })

  it('新增第二套不会顶替已启用的档案', async () => {
    const { service } = makeService()
    const first = await service.save(BASE)
    const second = await service.save({ ...BASE, name: '备用', apiKey: 'sk-two' })

    expect(second.profiles).toHaveLength(2)
    expect(second.activeId).toBe(first.activeId)
  })

  // 关键回归：编辑时留空 = 沿用旧 Key，不是清空
  it('编辑时 apiKey 留空沿用已保存的 Key', async () => {
    const { service } = makeService()
    const created = await service.save(BASE)
    const id = created.profiles[0]!.id

    const updated = await service.save({
      id,
      name: '改名了',
      provider: 'deepseek',
      baseUrl: 'https://api.deepseek.com/v1',
      model: 'deepseek-v4-flash',
      apiKey: ''
    })

    expect(updated.profiles[0]?.model).toBe('deepseek-v4-flash')
    expect(updated.profiles[0]?.hasApiKey).toBe(true)
    const config = await service.getActiveConfig()
    expect(config.apiKey).toBe('sk-secret')
  })

  it('新建档案时 Key 为空报错', async () => {
    const { service } = makeService()
    await expect(service.save({ ...BASE, apiKey: '' })).rejects.toThrow(/API Key 不能为空/)
  })

  it('设备不支持安全存储时报可读错误', async () => {
    const { service, box } = makeService()
    box.available = false
    await expect(service.save(BASE)).rejects.toThrow(/不支持安全加密存储/)
  })

  it('接口地址为空报错', async () => {
    const { service } = makeService()
    await expect(service.save({ ...BASE, baseUrl: '  ' })).rejects.toThrow(/接口地址不能为空/)
  })

  it('模型名为空报错', async () => {
    const { service } = makeService()
    await expect(service.save({ ...BASE, model: ' ' })).rejects.toThrow(/模型名称不能为空/)
  })

  it('编辑不存在的档案报错', async () => {
    const { service } = makeService()
    await expect(
      service.save({ id: 'nope', ...BASE })
    ).rejects.toThrow(/配置不存在/)
  })

  // 关键回归：非法 provider 回落 custom，不抛错
  it('非法 provider 回落 custom', async () => {
    const { service } = makeService()
    const view = await service.save({ ...BASE, provider: 'nope' as never })
    expect(view.profiles[0]?.provider).toBe('custom')
  })

  it('接口地址自动规范化到 /v1', async () => {
    const { service } = makeService()
    const view = await service.save({ ...BASE, baseUrl: 'https://api.deepseek.com/chat/completions' })
    expect(view.profiles[0]?.baseUrl).toBe('https://api.deepseek.com/v1')
  })

  it('档案名留空回落为供应商名', async () => {
    const { service } = makeService()
    const view = await service.save({ ...BASE, name: '  ' })
    expect(view.profiles[0]?.name).toBe('DeepSeek')
  })
})

describe('AiSettingsService 取配置', () => {
  it('未启用任何档案时给可读提示', async () => {
    const { service } = makeService()
    await expect(service.getActiveConfig()).rejects.toThrow(/尚未启用任何 AI 配置/)
  })

  it('返回明文配置供网关使用', async () => {
    const { service } = makeService()
    await service.save(BASE)
    const config = await service.getActiveConfig()
    expect(config).toEqual({
      provider: 'deepseek',
      baseUrl: 'https://api.deepseek.com/v1',
      model: 'deepseek-v4-pro',
      apiKey: 'sk-secret'
    })
  })

  it('启用的档案被删后不会回落到空', async () => {
    const { service } = makeService()
    const created = await service.save(BASE)
    const view = await service.remove(created.profiles[0]!.id)
    expect(view.activeId).toBeNull()
    await expect(service.getActiveConfig()).rejects.toThrow(/尚未启用任何 AI 配置/)
  })

  it('解密失败提示重新保存，不暴露异常细节', async () => {
    const { service, box } = makeService()
    await service.save(BASE)
    box.failDecrypt = true
    await expect(service.getActiveConfig()).rejects.toThrow(/API Key 解密失败，请重新保存设置/)
  })

  it('apiKeyForProfile 解密失败返回空串而非抛错', async () => {
    const { service, box } = makeService()
    const created = await service.save(BASE)
    box.failDecrypt = true
    await expect(service.apiKeyForProfile(created.profiles[0]!.id)).resolves.toBe('')
  })
})

describe('AiSettingsService remove / activate', () => {
  it('删除启用中的档案时顺延到第一套', async () => {
    const { service } = makeService()
    const first = await service.save(BASE)
    const second = await service.save({ ...BASE, name: '备用', apiKey: 'sk-two' })
    const firstId = first.profiles[0]!.id
    const secondId = second.profiles[1]!.id

    await service.activate(secondId)
    const after = await service.remove(secondId)

    expect(after.activeId).toBe(firstId)
    expect(after.profiles).toHaveLength(1)
  })

  it('删除非启用档案不影响 activeId', async () => {
    const { service } = makeService()
    const first = await service.save(BASE)
    const second = await service.save({ ...BASE, name: '备用', apiKey: 'sk-two' })
    const secondId = second.profiles[1]!.id

    // 切到第二套，再删第一套 —— 删的不是启用项，activeId 不应变
    await service.activate(secondId)
    const after = await service.remove(first.profiles[0]!.id)

    expect(after.activeId).toBe(secondId)
    expect(after.profiles).toHaveLength(1)
  })

  it('删除不存在的档案报错', async () => {
    const { service } = makeService()
    await expect(service.remove('nope')).rejects.toThrow(/配置不存在/)
  })

  it('启用不存在的档案报错', async () => {
    const { service } = makeService()
    await expect(service.activate('nope')).rejects.toThrow(/配置不存在/)
  })
})

describe('normalizeStoredSettings', () => {
  const newId = (): string => 'generated-id'

  it('非对象返回空配置', () => {
    expect(normalizeStoredSettings(null, newId)).toEqual({ version: 2, activeId: '', profiles: [] })
    expect(normalizeStoredSettings('字符串', newId)).toEqual({ version: 2, activeId: '', profiles: [] })
  })

  it('已是 v2 时原样归一', () => {
    const stored: StoredAiSettings = {
      version: 2,
      activeId: 'a',
      profiles: [
        { id: 'a', name: '甲', provider: 'glm', baseUrl: 'https://x/v1', model: 'glm-5.3', apiKeyCipher: 'c' }
      ]
    }
    const result = normalizeStoredSettings(stored, newId)
    expect(result.activeId).toBe('a')
    expect(result.profiles[0]?.apiKeyCipher).toBe('c')
  })

  // 关键回归：activeId 指向已不存在的档案时回落，不能留悬空 id
  it('activeId 悬空时回落到第一套', () => {
    const result = normalizeStoredSettings(
      {
        version: 2,
        activeId: 'ghost',
        profiles: [
          { id: 'a', name: '甲', provider: 'glm', baseUrl: 'https://x/v1', model: 'm', apiKeyCipher: '' }
        ]
      },
      newId
    )
    expect(result.activeId).toBe('a')
  })

  // v1 单套结构迁移
  it('v1 单套结构迁移成档案', () => {
    const result = normalizeStoredSettings(
      { baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-v4-pro', apiKeyCipher: 'cipher' },
      newId
    )
    expect(result.profiles).toHaveLength(1)
    expect(result.profiles[0]?.id).toBe('generated-id')
    expect(result.profiles[0]?.provider).toBe('deepseek')
    expect(result.profiles[0]?.name).toBe('DeepSeek')
    expect(result.activeId).toBe('generated-id')
  })

  it('v1 空结构返回空配置', () => {
    expect(normalizeStoredSettings({ baseUrl: '', model: '', apiKeyCipher: '' }, newId)).toEqual({
      version: 2,
      activeId: '',
      profiles: []
    })
  })

  it('丢弃结构非法的档案条目而不是整体失败', () => {
    const result = normalizeStoredSettings(
      {
        version: 2,
        activeId: '',
        profiles: [null, { name: '无 id' }, { id: 'ok', provider: 'kimi', name: '丙', baseUrl: 'u', model: 'm' }]
      },
      newId
    )
    expect(result.profiles).toHaveLength(1)
    expect(result.profiles[0]?.id).toBe('ok')
  })

  it('缺失字段安全回落', () => {
    const result = normalizeStoredSettings({ version: 2, profiles: [{ id: 'a' }] }, newId)
    expect(result.profiles[0]).toMatchObject({
      id: 'a',
      provider: 'custom',
      baseUrl: '',
      model: '',
      apiKeyCipher: ''
    })
  })

  it('旧档案没有「显示实时模型列表」字段时按 true 处理', () => {
    const result = normalizeStoredSettings({ version: 2, profiles: [{ id: 'a' }] }, newId)
    expect(result.profiles[0]?.showRemoteModels).toBe(true)
  })
})