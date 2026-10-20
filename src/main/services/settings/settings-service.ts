import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { SETTINGS_FILE_NAME } from '../../../shared/constants'
import { normalizeModelList } from '../../../shared/model-list'
import type { SafeStorageAdapter } from '../../../shared/safe-storage'
import { findAiProvider, isAiProviderId, matchProviderByBaseUrl } from '../../../shared/types'
import type {
  AiConfig,
  AiConfigView,
  AiFetchModelsInput,
  AiModelListResult,
  AiProfileInput,
  AiProfileView,
  AiProviderId
} from '../../../shared/types'
import { AiGatewayError, normalizeOpenAiBaseUrl } from '../ai-gateway/errors'
import { fetchModelIds } from '../ai-gateway/model-fetcher'
import { buildProviderHeaders, CLIENT_USER_AGENT, requiresCustomUserAgent } from '../ai-gateway/provider-headers'

/** 落盘结构 v2：多套档案 + 当前启用项 */
interface StoredSettings {
  version: 2
  activeId: string
  profiles: StoredProfile[]
}

interface StoredProfile {
  id: string
  name: string
  provider: AiProviderId
  baseUrl: string
  model: string
  apiKeyCipher: string
  /**
   * 用户勾选的模型清单：对话下拉只显示这些（外加当前正在用的那个）。
   * 旧配置文件没有这个字段，读出来时按空处理（加字段，不改 version）。
   */
  selectedModels?: string[]
}

const MAX_NAME_CHARS = 24

const EMPTY_SETTINGS: StoredSettings = { version: 2, activeId: '', profiles: [] }

/**
 * AI 配置服务：管理多套供应商档案，Key 一律经 safeStorage 加密后落盘。
 *
 * 存储结构从 v1（单套 baseUrl/model/apiKeyCipher）升级为 v2（档案数组）：
 * 读取时自动迁移 —— 旧的单套配置会被转成唯一档案，并按 baseUrl 反查补全 provider，
 * 因此升级不丢数据；下次保存即写回 v2。渲染层只能拿到脱敏视图（hasApiKey）。
 */
export class SettingsService {
  private readonly filePath: string

  constructor(
    directory: string,
    private readonly safeStorage: SafeStorageAdapter
  ) {
    this.filePath = join(directory, SETTINGS_FILE_NAME)
  }

  async getView(): Promise<AiConfigView> {
    const stored = await this.read()
    const profiles = stored.profiles.map(toProfileView)
    return {
      profiles,
      activeId: profiles.some((item) => item.id === stored.activeId) ? stored.activeId : null
    }
  }

  /** 取当前启用档案的明文配置，供 AiGateway 发请求；Key 只在主进程内解密 */
  async getAiConfig(): Promise<AiConfig> {
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
      apiKey: this.decryptKey(profile)
    }
  }

  /** 新建（id 留空）或更新档案；返回最新视图 */
  async save(input: AiProfileInput): Promise<AiConfigView> {
    const baseUrl = normalizeOpenAiBaseUrl(input.baseUrl)
    const model = input.model.trim()
    // 模型允许留空：设置页只负责供应商与 Key，具体模型在对话侧的下拉里选择。
    // 留空时不会阻断保存，真正发请求前由 getAiConfig 给出可读提示。
    if (!baseUrl) throw new AiGatewayError('接口地址不能为空')

    const stored = await this.read()
    const existing = input.id
      ? stored.profiles.find((item) => item.id === input.id)
      : undefined
    if (input.id && !existing) throw new AiGatewayError('配置不存在')

    const apiKey = input.apiKey?.trim() ?? ''
    if (apiKey) {
      if (!this.safeStorage.isEncryptionAvailable()) {
        throw new AiGatewayError('当前系统不支持安全加密存储，无法保存 API Key')
      }
    } else if (!existing?.apiKeyCipher) {
      throw new AiGatewayError('API Key 不能为空')
    }

    const provider = isAiProviderId(input.provider) ? input.provider : 'custom'
    const profile: StoredProfile = {
      id: existing?.id ?? randomUUID(),
      name: normalizeName(input.name, findAiProvider(provider).name),
      provider,
      baseUrl,
      model,
      apiKeyCipher: apiKey
        ? this.safeStorage.encryptString(apiKey).toString('base64')
        : (existing?.apiKeyCipher ?? ''),
      // 留空表示「不改动已保存的勾选」，空数组表示清空
      selectedModels: normalizeModelList(input.selectedModels ?? existing?.selectedModels)
    }

    const profiles = existing
      ? stored.profiles.map((item) => (item.id === profile.id ? profile : item))
      : [...stored.profiles, profile]

    await this.write({
      version: 2,
      // 首个档案自动启用，避免用户保存完还要再点一次「启用」
      activeId: profiles.some((item) => item.id === stored.activeId)
        ? stored.activeId
        : profile.id,
      profiles
    })

    return this.getView()
  }

  async remove(id: string): Promise<AiConfigView> {
    const stored = await this.read()
    if (!stored.profiles.some((item) => item.id === id)) {
      throw new AiGatewayError('配置不存在')
    }

    const profiles = stored.profiles.filter((item) => item.id !== id)
    const activeId =
      stored.activeId === id ? (profiles[0]?.id ?? '') : stored.activeId

    await this.write({ version: 2, activeId, profiles })
    return this.getView()
  }

  async activate(id: string): Promise<AiConfigView> {
    const stored = await this.read()
    if (!stored.profiles.some((item) => item.id === id)) {
      throw new AiGatewayError('配置不存在')
    }
    await this.write({ ...stored, activeId: id })
    return this.getView()
  }

  /**
   * 拉取模型列表：优先用输入的 Key，未填则回落到指定档案（缺省为启用档案）已保存的 Key。
   * 远端失败时，若该供应商有内置推荐模型则降级返回（source = preset），
   * 自定义供应商没有预设列表，直接抛出脱敏后的错误。
   */
  async fetchModels(input: AiFetchModelsInput): Promise<AiModelListResult> {
    const baseUrl = normalizeOpenAiBaseUrl(input.baseUrl)
    if (!baseUrl) throw new AiGatewayError('请先填写接口地址')

    const stored = await this.read()
    const profileId = input.profileId ?? stored.activeId
    const storedProfile = stored.profiles.find((item) => item.id === profileId)
    const apiKey = input.apiKey?.trim() || (storedProfile ? this.decryptKey(storedProfile) : '')
    if (!apiKey) throw new AiGatewayError('请先填写或保存 API Key')

    try {
      const models = await fetchModelIds({ baseUrl, apiKey, headers: this.modelListHeaders(input) })
      return { models, source: 'remote' }
    } catch (error) {
      const preset = findAiProvider(input.provider)
      if (preset.models.length === 0) throw error

      const reason = error instanceof Error ? error.message : '未知原因'
      return {
        models: [...preset.models],
        source: 'preset',
        message: `未能连接供应商接口（${reason}），已列出内置推荐模型`
      }
    }
  }

  /** 部分供应商（如 OpenCode Go）对模型列表同样要求客户端标识与稳定会话 ID */
  private modelListHeaders(input: AiFetchModelsInput): Record<string, string> {
    const headerInput = {
      provider: input.provider,
      baseUrl: input.baseUrl,
      sessionId: input.profileId ?? 'tool-box-model-list'
    }
    return {
      ...buildProviderHeaders(headerInput),
      ...(requiresCustomUserAgent(headerInput) ? { 'User-Agent': CLIENT_USER_AGENT } : {})
    }
  }

  // ==================== 持久化 ====================
  private async read(): Promise<StoredSettings> {
    let raw: string
    try {
      raw = await readFile(this.filePath, 'utf8')
    } catch (error) {
      if (this.isMissingFileError(error)) return EMPTY_SETTINGS
      throw new AiGatewayError('AI 配置文件读取失败', error)
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch (error) {
      throw new AiGatewayError('AI 配置文件格式损坏', error)
    }

    return normalizeStoredSettings(parsed)
  }

  private async write(stored: StoredSettings): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true })
    await writeFile(this.filePath, `${JSON.stringify(stored, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600
    })
  }

  private decryptKey(profile: StoredProfile): string {
    if (!profile.apiKeyCipher) return ''
    try {
      const apiKey = this.safeStorage.decryptString(
        Buffer.from(profile.apiKeyCipher, 'base64')
      )
      if (!apiKey) throw new Error('解密结果为空')
      return apiKey
    } catch (error) {
      throw new AiGatewayError('API Key 解密失败，请重新保存设置', error)
    }
  }

  private isMissingFileError(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: unknown }).code === 'ENOENT'
    )
  }
}

function toProfileView(profile: StoredProfile): AiProfileView {
  return {
    id: profile.id,
    name: profile.name,
    provider: profile.provider,
    baseUrl: profile.baseUrl,
    model: profile.model,
    hasApiKey: profile.apiKeyCipher.length > 0,
    selectedModels: profile.selectedModels ?? []
  }
}

function normalizeName(input: string, fallback: string): string {
  const name = input.replace(/\s+/g, ' ').trim()
  if (!name) return fallback.slice(0, MAX_NAME_CHARS)
  return name.length > MAX_NAME_CHARS ? name.slice(0, MAX_NAME_CHARS) : name
}

/**
 * 把任意历史版本的结构归一为 v2。
 * v1（单套）→ 生成唯一档案并按 baseUrl 反查供应商；字段缺失一律安全回落，绝不抛错。
 */
export function normalizeStoredSettings(parsed: unknown): StoredSettings {
  if (typeof parsed !== 'object' || parsed === null) return EMPTY_SETTINGS
  const record = parsed as Record<string, unknown>

  if (Array.isArray(record.profiles)) {
    const profiles = record.profiles
      .map(toStoredProfile)
      .filter((item): item is StoredProfile => item !== null)
    const activeId =
      typeof record.activeId === 'string' &&
      profiles.some((item) => item.id === record.activeId)
        ? record.activeId
        : (profiles[0]?.id ?? '')
    return { version: 2, activeId, profiles }
  }

  // v1：单套结构迁移
  const baseUrl = typeof record.baseUrl === 'string' ? record.baseUrl.trim() : ''
  const model = typeof record.model === 'string' ? record.model.trim() : ''
  const apiKeyCipher =
    typeof record.apiKeyCipher === 'string' ? record.apiKeyCipher : ''
  if (!baseUrl && !model && !apiKeyCipher) return EMPTY_SETTINGS

  const provider = matchProviderByBaseUrl(baseUrl)
  const profile: StoredProfile = {
    id: randomUUID(),
    name: normalizeName('', findAiProvider(provider).name),
    provider,
    baseUrl,
    model,
    apiKeyCipher,
    selectedModels: []
  }
  return { version: 2, activeId: profile.id, profiles: [profile] }
}

function toStoredProfile(value: unknown): StoredProfile | null {
  if (typeof value !== 'object' || value === null) return null
  const record = value as Record<string, unknown>
  const id = typeof record.id === 'string' && record.id ? record.id : randomUUID()
  const baseUrl = typeof record.baseUrl === 'string' ? record.baseUrl.trim() : ''
  const provider = isAiProviderId(record.provider)
    ? record.provider
    : matchProviderByBaseUrl(baseUrl)

  return {
    id,
    name: normalizeName(
      typeof record.name === 'string' ? record.name : '',
      findAiProvider(provider).name
    ),
    provider,
    baseUrl,
    model: typeof record.model === 'string' ? record.model.trim() : '',
    apiKeyCipher: typeof record.apiKeyCipher === 'string' ? record.apiKeyCipher : '',
    // 旧档案没有勾选清单：按空处理（下拉回落到内置推荐）
    selectedModels: normalizeModelList(record.selectedModels)
  }
}
