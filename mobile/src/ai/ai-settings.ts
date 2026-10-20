/**
 * AI 档案存储（手机端）—— 与桌面端 `SettingsService` 行为对齐。
 *
 * 落盘位置：复用已存在的 kv 表（key = `ai_settings`），不新建表、不改 schema。
 *
 * 加密链路（⚠️ 与桌面端不同）：
 * - 桌面端：API Key 交给 Electron `safeStorage`（Windows DPAPI），存 JSON 文件。
 * - 手机端：没有 safeStorage 的对等物，改用**独立的** SecureStore 密钥
 *   `ai-settings-key`，配现有的 AES-256-GCM 信封格式（与密码箱同一套）。
 *
 * 为什么不复用密码箱主密钥：
 * - 密码箱主密钥丢失 = 密码永久不可解。让 AI Key 绑在它上面，
 *   会因为「删 AI 配置」这类操作牵连密码箱，风险不对等。
 * - 两者信封格式一致（已与桌面端 fixture 交叉验证），密文不互通但格式相同。
 *
 * 明文 API Key 只在 `getActiveConfig()` / `apiKeyForProfile()` 内解密并直接交给调用方，
 * 绝不落库、绝不进日志、绝不进脱敏视图。
 */
import {
  AiGatewayError,
  findAiProvider,
  isAiProviderId,
  matchProviderByBaseUrl,
  normalizeOpenAiBaseUrl
} from '../shared-bridge'
import type { AiConfigView, AiProfileInput, AiProfileView, AiProviderId } from '../shared-bridge'

import type { SecretStringBox } from '../data/secret-box'

/** kv 表里的存储键 */
export const AI_SETTINGS_KV_KEY = 'ai_settings'

/** 档案名上限，与桌面端一致 */
const MAX_NAME_CHARS = 24

/** 本服务需要的最小存储能力，便于测试注入假实现 */
export interface KvStore {
  kvGet(key: string): Promise<string | null>
  kvSet(key: string, value: string): Promise<void>
}

/** 落盘结构：与桌面端 v2 同形 */
export interface StoredAiProfile {
  id: string
  name: string
  provider: AiProviderId
  baseUrl: string
  model: string
  /** API Key 的 AES-GCM 信封（JSON 字符串） */
  apiKeyCipher: string
  /**
   * 对话下拉是否显示供应商实时模型列表。
   * 旧档案没有这个字段，读出来时按 true 处理（加字段，不改 version）。
   */
  showRemoteModels?: boolean
}

export interface StoredAiSettings {
  version: 2
  activeId: string
  profiles: StoredAiProfile[]
}

const EMPTY_SETTINGS: StoredAiSettings = { version: 2, activeId: '', profiles: [] }

/** 脱敏视图：只暴露 hasApiKey，绝不含密文或明文 */
function toView(profile: StoredAiProfile): AiProfileView {
  return {
    id: profile.id,
    name: profile.name,
    provider: profile.provider,
    baseUrl: profile.baseUrl,
    model: profile.model,
    hasApiKey: Boolean(profile.apiKeyCipher),
    showRemoteModels: profile.showRemoteModels ?? true
  }
}

export class AiSettingsService {
  constructor(
    private readonly kv: KvStore,
    private readonly secretBox: SecretStringBox,
    private readonly newId: () => string
  ) {}

  async getView(): Promise<AiConfigView> {
    const stored = await this.read()
    const profiles = stored.profiles.map(toView)
    return {
      profiles,
      activeId: profiles.some((item) => item.id === stored.activeId) ? stored.activeId : null
    }
  }

  /** 取当前启用档案的明文配置，供流式请求使用 */
  async getActiveConfig(): Promise<{
    provider: AiProviderId
    baseUrl: string
    model: string
    apiKey: string
  }> {
    const stored = await this.read()
    const profile = stored.profiles.find((item) => item.id === stored.activeId)
    if (!profile) {
      throw new AiGatewayError('尚未启用任何 AI 配置，请在设置中选择一套配置并启用')
    }
    if (!profile.baseUrl || !profile.model) {
      throw new AiGatewayError('当前启用的配置缺少接口地址或模型名称，请补全后再试')
    }
    return {
      provider: profile.provider,
      baseUrl: profile.baseUrl,
      model: profile.model,
      apiKey: await this.decryptKey(profile)
    }
  }

  async save(input: AiProfileInput): Promise<AiConfigView> {
    const baseUrl = normalizeOpenAiBaseUrl(input.baseUrl)
    const model = input.model.trim()
    if (!baseUrl) throw new AiGatewayError('接口地址不能为空')
    if (!model) throw new AiGatewayError('模型名称不能为空')

    const stored = await this.read()
    const existing = input.id ? stored.profiles.find((item) => item.id === input.id) : undefined
    if (input.id && !existing) throw new AiGatewayError('配置不存在')

    const apiKey = input.apiKey?.trim() ?? ''
    // 留空 = 沿用已保存的 Key；只有新建档案时留空才报错
    if (apiKey) {
      await this.secretBox.assertAvailable()
    } else if (!existing?.apiKeyCipher) {
      throw new AiGatewayError('API Key 不能为空')
    }

    const provider = isAiProviderId(input.provider) ? input.provider : 'custom'
    const profile: StoredAiProfile = {
      id: existing?.id ?? this.newId(),
      name: normalizeName(input.name, findAiProvider(provider).name),
      provider,
      baseUrl,
      model,
      apiKeyCipher: apiKey
        ? await this.secretBox.encryptText(apiKey)
        : (existing?.apiKeyCipher ?? ''),
      // 留空视为「显示」：老档案没有这个字段时行为不变
      showRemoteModels: input.showRemoteModels ?? existing?.showRemoteModels ?? true
    }

    const profiles = existing
      ? stored.profiles.map((item) => (item.id === profile.id ? profile : item))
      : [...stored.profiles, profile]

    await this.write({
      version: 2,
      // 首个档案自动启用，省得保存完还要再点一次「启用」
      activeId: profiles.some((item) => item.id === stored.activeId) ? stored.activeId : profile.id,
      profiles
    })

    return this.getView()
  }

  async remove(id: string): Promise<AiConfigView> {
    const stored = await this.read()
    if (!stored.profiles.some((item) => item.id === id)) throw new AiGatewayError('配置不存在')

    const profiles = stored.profiles.filter((item) => item.id !== id)
    // 删掉启用中的档案时顺延到第一套
    const activeId = stored.activeId === id ? (profiles[0]?.id ?? '') : stored.activeId

    await this.write({ version: 2, activeId, profiles })
    return this.getView()
  }

  async activate(id: string): Promise<AiConfigView> {
    const stored = await this.read()
    if (!stored.profiles.some((item) => item.id === id)) throw new AiGatewayError('配置不存在')
    await this.write({ ...stored, activeId: id })
    return this.getView()
  }

  /**
   * 取指定档案（缺省为启用档案）的明文 Key，供「拉取模型列表」复用。
   * 解密失败返回空串而不是抛错：用户仍可能手动重填 Key，不该被挡住。
   */
  async apiKeyForProfile(profileId?: string): Promise<string> {
    const stored = await this.read()
    const profile = stored.profiles.find((item) => item.id === (profileId ?? stored.activeId))
    if (!profile) return ''
    try {
      return await this.decryptKey(profile)
    } catch {
      return ''
    }
  }

  private async decryptKey(profile: StoredAiProfile): Promise<string> {
    if (!profile.apiKeyCipher) return ''
    try {
      return await this.secretBox.decryptText(profile.apiKeyCipher)
    } catch {
      // 不把解密异常细节抛给用户，只提示重新保存
      throw new AiGatewayError('API Key 解密失败，请重新保存设置')
    }
  }

  private async read(): Promise<StoredAiSettings> {
    const raw = await this.kv.kvGet(AI_SETTINGS_KV_KEY)
    if (!raw) return EMPTY_SETTINGS
    try {
      return normalizeStoredSettings(JSON.parse(raw), this.newId)
    } catch {
      throw new AiGatewayError('AI 配置文件格式损坏')
    }
  }

  private async write(stored: StoredAiSettings): Promise<void> {
    await this.kv.kvSet(AI_SETTINGS_KV_KEY, JSON.stringify(stored))
  }
}

export function normalizeName(input: string, fallback: string): string {
  const trimmed = input.trim()
  return (trimmed || fallback).slice(0, MAX_NAME_CHARS)
}

/**
 * 把任意历史版本的结构归一为 v2。
 * v1（单套）→ 生成唯一档案并按 baseUrl 反查供应商；字段缺失一律安全回落，绝不抛错。
 */
export function normalizeStoredSettings(parsed: unknown, newId: () => string): StoredAiSettings {
  if (typeof parsed !== 'object' || parsed === null) return EMPTY_SETTINGS
  const record = parsed as Record<string, unknown>

  if (Array.isArray(record.profiles)) {
    const profiles = record.profiles
      .map((item) => toStoredProfile(item))
      .filter((item): item is StoredAiProfile => item !== null)
    const activeId =
      typeof record.activeId === 'string' && profiles.some((item) => item.id === record.activeId)
        ? record.activeId
        : (profiles[0]?.id ?? '')
    return { version: 2, activeId, profiles }
  }

  // v1：单套结构迁移
  const baseUrl = typeof record.baseUrl === 'string' ? record.baseUrl.trim() : ''
  const model = typeof record.model === 'string' ? record.model.trim() : ''
  const apiKeyCipher = typeof record.apiKeyCipher === 'string' ? record.apiKeyCipher : ''
  if (!baseUrl && !model && !apiKeyCipher) return EMPTY_SETTINGS

  const provider = matchProviderByBaseUrl(baseUrl)
  const profile: StoredAiProfile = {
    id: newId(),
    name: normalizeName('', findAiProvider(provider).name),
    provider,
    baseUrl,
    model,
    apiKeyCipher
  }
  return { version: 2, activeId: profile.id, profiles: [profile] }
}

function toStoredProfile(item: unknown): StoredAiProfile | null {
  if (typeof item !== 'object' || item === null) return null
  const record = item as Record<string, unknown>
  if (typeof record.id !== 'string' || !record.id) return null

  const provider = isAiProviderId(record.provider) ? record.provider : 'custom'
  return {
    id: record.id,
    name: typeof record.name === 'string' ? record.name : normalizeName('', findAiProvider(provider).name),
    provider,
    baseUrl: typeof record.baseUrl === 'string' ? record.baseUrl : '',
    model: typeof record.model === 'string' ? record.model : '',
    apiKeyCipher: typeof record.apiKeyCipher === 'string' ? record.apiKeyCipher : '',
    // 旧档案没有这个字段：按「显示实时列表」处理
    showRemoteModels: record.showRemoteModels !== false
  }
}