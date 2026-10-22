import { execFile } from 'node:child_process'
import { homedir } from 'node:os'
import { join, normalize } from 'node:path'
import Database from 'better-sqlite3'
import { acpObject } from './acp-connection'
import { OpenCodeError } from './opencode-error'

const RECENT_MODEL_AGE_MS = 262974.6 * 60 * 1000

/** 只保留 Desktop 可见性判定需要的非敏感目录字段。 */
interface ModelVisibilityEntry {
  id: string
  group: string
  released: number
}

/** 复现 Desktop 2.1.1 的显式显示 / 隐藏及近期家族默认模型规则。 */
export function visibleOpenCodeModelIds(
  preferences: unknown,
  catalog: unknown,
  now = Date.now()
): string[] {
  const settings = acpObject(preferences)
  if (!settings || !Array.isArray(settings.user) || settings.user.length > 10000)
    throw new OpenCodeError('OpenCode Desktop 模型偏好格式不兼容，请更新桌面版后重试')
  const response = acpObject(catalog)
  if (!Array.isArray(response?.data) || response.data.length > 10000)
    throw new OpenCodeError('无法读取 OpenCode 模型目录，请重试连接')
  const explicit = new Map<string, string>()
  for (const raw of settings.user) {
    const item = acpObject(raw)
    if (
      typeof item?.providerID !== 'string' ||
      typeof item.modelID !== 'string' ||
      `${item.providerID}/${item.modelID}`.length > 512
    )
      continue
    if (item.visibility === 'show' || item.visibility === 'hide')
      explicit.set(`${item.providerID}/${item.modelID}`, item.visibility)
  }
  const entries: ModelVisibilityEntry[] = response.data.flatMap((raw) => {
    const item = acpObject(raw)
    if (
      !item ||
      item.status === 'deprecated' ||
      typeof item.id !== 'string' ||
      typeof item.providerID !== 'string'
    )
      return []
    const id = `${item.providerID}/${item.id}`
    if (id.length > 512) return []
    const time = acpObject(item.time)
    const timestamp = typeof time?.released === 'number' ? time.released : NaN
    const date = new Date(timestamp)
    const released = Number.isFinite(date.getTime())
      ? Date.parse(date.toISOString().slice(0, 10))
      : NaN
    const costs = Array.isArray(item.cost) ? item.cost.slice(0, 100).map(acpObject) : []
    const cost = costs.find((tier) => tier && tier.tier === undefined) ?? costs[0]
    const free = item.providerID === 'opencode' && (cost?.input ?? 0) === 0
    const family = typeof item.family === 'string' ? item.family.slice(0, 512) : ''
    return [{ id, released, group: JSON.stringify([item.providerID, family, free]) }]
  })
  const latest = new Map<string, ModelVisibilityEntry>()
  for (const entry of entries) {
    if (Math.abs(now - entry.released) >= RECENT_MODEL_AGE_MS || !Number.isFinite(entry.released))
      continue
    const previous = latest.get(entry.group)
    if (!previous || entry.released > previous.released) latest.set(entry.group, entry)
  }
  const defaults = new Set([...latest.values()].map((entry) => entry.id))
  return [
    ...new Set(
      entries
        .filter((entry) => {
          const visibility = explicit.get(entry.id)
          if (visibility === 'hide') return false
          return visibility === 'show' || defaults.has(entry.id) || !Number.isFinite(entry.released)
        })
        .map((entry) => entry.id)
    )
  ]
}

/** 固定查询单个模型偏好键，连接始终只读，不执行 pragma 或迁移。 */
export function readOpenCodeModelPreferences(file: string): unknown {
  let database: Database.Database | undefined
  try {
    database = new Database(file, { readonly: true, fileMustExist: true, timeout: 1000 })
    const row = database
      .prepare('SELECT value FROM state WHERE name = ? AND key = ?')
      .get('opencode.global.dat', 'model') as { value?: unknown } | undefined
    if (!row) return { user: [] }
    if (typeof row.value !== 'string' || row.value.length > 1000000) throw new Error('偏好格式无效')
    return JSON.parse(row.value) as unknown
  } catch {
    throw new OpenCodeError('无法读取 OpenCode Desktop 模型勾选，请先打开桌面版后重试连接')
  } finally {
    database?.close()
  }
}

/** CLI 自行处理服务连接；只取目录快照，不读取或传递任何登录凭据。 */
export async function readOpenCodeVisibleModels(
  executable: string,
  directory: string
): Promise<string[]> {
  const base =
    process.platform === 'win32'
      ? process.env.APPDATA
      : process.platform === 'darwin'
        ? join(homedir(), 'Library', 'Application Support')
        : (process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'))
  if (!base) throw new OpenCodeError('未找到 OpenCode Desktop 配置目录')
  const preferences = readOpenCodeModelPreferences(
    join(base, 'ai.opencode.desktop', 'drafts.sqlite')
  )
  const catalog = await new Promise<unknown>((resolve, reject) => {
    execFile(
      executable,
      ['api', 'model.list', '--param', `location[directory]=${directory}`],
      { windowsHide: true, timeout: 10000, maxBuffer: 12000000 },
      (error, stdout) => {
        if (error) {
          reject(new OpenCodeError('无法同步 OpenCode 模型目录，请确认 Desktop 服务可用后重试'))
          return
        }
        try {
          resolve(JSON.parse(stdout) as unknown)
        } catch {
          reject(new OpenCodeError('OpenCode 返回的模型目录格式不兼容'))
        }
      }
    )
  })
  const location = acpObject(acpObject(catalog)?.location)
  const returnedDirectory = typeof location?.directory === 'string' ? location.directory : ''
  const normalized = (value: string): string =>
    process.platform === 'win32' ? normalize(value).toLowerCase() : normalize(value)
  if (!returnedDirectory || normalized(returnedDirectory) !== normalized(directory))
    throw new OpenCodeError('OpenCode 返回的模型目录不属于当前项目，请更新 Desktop 后重试')
  return visibleOpenCodeModelIds(preferences, catalog)
}
