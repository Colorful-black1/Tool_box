import { readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { CodingAgentError } from './adapter'
import type { ClaudeProviderSettings } from './claude-provider-settings'

const MAX_CONFIG_BYTES = 512 * 1024
const PROFILE_ID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i
const object = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null

function text(value: unknown, limit: number): value is string {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    value.length <= limit &&
    Array.from(value).every((character) => {
      const code = character.charCodeAt(0)
      return code >= 32 && code !== 127
    })
  )
}

/** Desktop 第三方数据根；历史和网关配置使用同一 profile，不能混用官方数据根。 */
export function claudeDesktopDataDirectory(): string {
  if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA
    if (!local || !isAbsolute(local)) throw new CodingAgentError('未找到 Claude Desktop 配置目录')
    return join(local, 'Claude-3p')
  }
  return join(
    homedir(),
    ...(process.platform === 'darwin' ? ['Library', 'Application Support'] : ['.config']),
    'Claude-3p'
  )
}

async function readJson(file: string): Promise<Record<string, unknown>> {
  try {
    const info = await stat(file)
    if (!info.isFile() || info.size > MAX_CONFIG_BYTES)
      throw new CodingAgentError('Claude Desktop 配置无效或超过读取上限')
    const result = object(JSON.parse((await readFile(file, 'utf8')).replace(/^\uFEFF/, '')))
    if (!result) throw new CodingAgentError('Claude Desktop 配置格式无效')
    return result
  } catch (error) {
    if (error instanceof CodingAgentError) throw error
    throw new CodingAgentError(
      '无法读取 Claude Desktop 配置，请在 CC Switch 的 Claude Desktop 页面启用第三方供应商',
      { cause: error }
    )
  }
}

function models(value: unknown): NonNullable<ClaudeProviderSettings['models']> {
  if (!Array.isArray(value) || value.length > 200)
    throw new CodingAgentError('Claude Desktop 模型列表无效或超过 200 项')
  const seen = new Set<string>()
  return value.map((raw) => {
    const item = object(raw)
    if (
      !item ||
      !text(item.name, 200) ||
      (item.labelOverride !== undefined &&
        item.labelOverride !== '' &&
        !text(item.labelOverride, 100))
    )
      throw new CodingAgentError('Claude Desktop 模型配置无效')
    const value = item.name.trim()
    if (seen.has(value)) throw new CodingAgentError('Claude Desktop 模型配置存在重复项')
    seen.add(value)
    return {
      value,
      label: typeof item.labelOverride === 'string' ? item.labelOverride.trim() || value : value
    }
  })
}

/** 仅查询网关的模型元数据；不跟随跳转，不发送对话，并限制响应体积与等待时间。 */
async function discoverModels(base: string, token: string): Promise<unknown> {
  try {
    const response = await fetch(`${base.replace(/\/$/, '')}/v1/models`, {
      headers: { authorization: `Bearer ${token}`, 'anthropic-version': '2023-06-01' },
      signal: AbortSignal.timeout(5000),
      redirect: 'error'
    })
    if (!response.ok || !response.body) throw new CodingAgentError('网关未返回可用模型列表')
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let body = '',
      size = 0
    try {
      while (true) {
        const item = await reader.read()
        if (item.done) break
        size += item.value.byteLength
        if (size > MAX_CONFIG_BYTES) {
          await reader.cancel()
          throw new CodingAgentError('网关模型列表超过读取上限')
        }
        body += decoder.decode(item.value, { stream: true })
      }
      body += decoder.decode()
    } finally {
      reader.releaseLock()
    }
    const data = object(JSON.parse(body))?.data
    if (!Array.isArray(data)) throw new CodingAgentError('网关模型列表格式无效')
    return data.map((raw) => {
      const item = object(raw)
      return { name: item?.id, labelOverride: item?.display_name ?? item?.id }
    })
  } catch (error) {
    throw new CodingAgentError(
      '无法读取 Claude Desktop 网关模型，请确认供应商可用、CC Switch 路由正在运行，或配置模型列表',
      { cause: error }
    )
  }
}

/** 只使用当前应用的第三方 profile；缺失或损坏时不猜测其他 profile 或 Code 配置。 */
export async function readClaudeDesktopProviderSettings(): Promise<ClaudeProviderSettings> {
  const directory = join(claudeDesktopDataDirectory(), 'configLibrary')
  const meta = await readJson(join(directory, '_meta.json'))
  const id = meta.appliedId
  if (
    typeof id !== 'string' ||
    !PROFILE_ID.test(id) ||
    !Array.isArray(meta.entries) ||
    meta.entries.length > 200 ||
    !meta.entries.some((entry) => object(entry)?.id === id)
  )
    throw new CodingAgentError('Claude Desktop 未启用有效的第三方配置，请在 CC Switch 中重新切换')
  const profile = await readJson(join(directory, `${id}.json`))
  if (profile.inferenceProvider !== 'gateway' || profile.inferenceGatewayAuthScheme !== 'bearer')
    throw new CodingAgentError('Claude Desktop 当前配置不是受支持的第三方网关；不使用官方登录回退')
  const token = profile.inferenceGatewayApiKey
  const address = profile.inferenceGatewayBaseUrl
  if (!text(token, 16384) || !text(address, 4096))
    throw new CodingAgentError('Claude Desktop 网关地址或认证配置无效')
  let url: URL
  try {
    url = new URL(address)
  } catch (error) {
    throw new CodingAgentError('Claude Desktop 网关地址格式无效', { cause: error })
  }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new CodingAgentError('Claude Desktop 网关需使用 HTTPS 或本机回环 HTTP，且不含 URL 凭据')
  const base = url.toString().replace(/\/$/, '')
  const configured =
    profile.inferenceModels === undefined ||
    (Array.isArray(profile.inferenceModels) && profile.inferenceModels.length === 0)
      ? await discoverModels(base, token.trim())
      : profile.inferenceModels
  const available = models(configured)
  if (!available.length) throw new CodingAgentError('Claude Desktop 没有可用模型，请检查供应商配置')
  return {
    env: { ANTHROPIC_BASE_URL: base, ANTHROPIC_AUTH_TOKEN: token.trim() },
    model: available[0].value,
    models: available
  }
}
