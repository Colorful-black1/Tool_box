import { readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { CodingAgentError } from './adapter'

/** 认证环境仅用于 Claude 子进程；模型目录可转换为不含凭据的视图。 */
export interface ClaudeProviderSettings {
  env: Record<string, string>
  model?: string
  models?: Array<{ value: string; label: string }>
}

const PROVIDER_ENV_KEYS = [
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_MODEL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'ANTHROPIC_SMALL_FAST_MODEL',
  'ANTHROPIC_REASONING_MODEL'
] as const

const object = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null

/** 每次启动查询重读用户路由；不加载项目文件、hooks、权限或凭据执行助手。 */
export async function readClaudeProviderSettings(): Promise<ClaudeProviderSettings> {
  const directory = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude')
  if (!isAbsolute(directory)) throw new CodingAgentError('Claude 配置目录必须使用绝对路径')
  const file = join(directory, 'settings.json')
  let body: Record<string, unknown> | null
  try {
    const info = await stat(file)
    if (!info.isFile() || info.size > 512 * 1024)
      throw new CodingAgentError(
        'Claude 用户配置无效或超过读取上限，请在 Claude / CC Switch 中检查'
      )
    body = object(JSON.parse((await readFile(file, 'utf8')).replace(/^\uFEFF/, '')) as unknown)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { env: {} }
    if (error instanceof CodingAgentError) throw error
    console.warn('[Claude] 用户供应商配置读取失败', {
      kind: error instanceof SyntaxError ? 'invalid-json' : 'unreadable'
    })
    throw new CodingAgentError('无法读取 Claude 用户配置，请检查文件权限和 JSON 格式；未发送任务', {
      cause: error
    })
  }
  if (!body) throw new CodingAgentError('Claude 用户配置格式无效，请在 Claude / CC Switch 中检查')
  const source: Record<string, unknown> | null = body.env === undefined ? {} : object(body.env)
  if (!source) throw new CodingAgentError('Claude 供应商环境配置格式无效')
  const env: Record<string, string> = {}
  for (const key of PROVIDER_ENV_KEYS) {
    const value = source[key]
    if (value === undefined) continue
    if (typeof value !== 'string' || value.length > 16384 || value.includes('\0'))
      throw new CodingAgentError('Claude 供应商配置含无效字段，请在 Claude / CC Switch 中检查')
    env[key] = value
  }
  if (
    body.model !== undefined &&
    (typeof body.model !== 'string' || body.model.length > 200 || body.model.includes('\0'))
  )
    throw new CodingAgentError('Claude 默认模型配置无效')
  const model = typeof body.model === 'string' ? body.model.trim() : undefined
  return { env, ...(model ? { model } : {}) }
}
