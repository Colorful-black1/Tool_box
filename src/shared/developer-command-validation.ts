import { COMMAND_RISKS, COMMAND_SHELLS } from './developer-commands'
import type {
  DeveloperCommandFields,
  DeveloperCommandInput,
  DeveloperCommandSnapshot,
  DeveloperCommandToggle
} from './developer-commands'
import { DEVELOPER_COMMAND_PRESETS } from './developer-command-presets'

/** 有界文档校验与 IPC 校验共用，命令原文按原始长度检查并保留。 */
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('命令记录格式无效')
  return value as Record<string, unknown>
}
function text(value: unknown, label: string, max: number, empty = false): string {
  if (typeof value !== 'string' || value.length > max || (!empty && !value.trim()))
    throw new Error(`${label}${empty ? '格式无效或过长' : '不能为空且不能超过 ' + max + ' 字符'}`)
  return value
}
function revision(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    throw new Error('命令库版本无效')
  return value
}
function commandId(value: unknown, personal = false): string {
  const id = text(value, '命令引用', 100)
  if (
    !/^user:[a-f0-9-]{36}$/.test(id) &&
    (personal || !DEVELOPER_COMMAND_PRESETS.some((item) => item.id === id))
  )
    throw new Error('命令引用无效')
  return id
}
function fields(value: Record<string, unknown>): DeveloperCommandFields {
  if (
    !COMMAND_SHELLS.some((item) => item === value.shell) ||
    !COMMAND_RISKS.some((item) => item === value.risk)
  )
    throw new Error('Shell 或注意事项等级无效')
  if (!Array.isArray(value.tags) || value.tags.length > 8) throw new Error('标签最多 8 个')
  const tags = value.tags.map((tag) => text(tag, '标签', 24).trim())
  if (new Set(tags).size !== tags.length) throw new Error('标签不能重复')
  return {
    title: text(value.title, '标题', 80).trim(),
    command: text(value.command, '命令', 8000),
    category: text(value.category, '分类', 32).trim(),
    description: text(value.description, '用途说明', 2000, true),
    tags,
    shell: value.shell as DeveloperCommandFields['shell'],
    risk: value.risk as DeveloperCommandFields['risk']
  }
}
export function parseDeveloperCommandInput(value: unknown): DeveloperCommandInput {
  const input = object(value)
  return {
    ...fields(input),
    expectedRevision: revision(input.expectedRevision),
    ...(input.id === undefined ? {} : { id: commandId(input.id, true) })
  }
}
export function parseDeveloperCommandToggle(value: unknown): DeveloperCommandToggle {
  const input = object(value)
  if (typeof input.value !== 'boolean') throw new Error('命令操作无效')
  return {
    id: commandId(input.id),
    value: input.value,
    expectedRevision: revision(input.expectedRevision)
  }
}
export function parseDeveloperCommandSnapshot(value: unknown): DeveloperCommandSnapshot {
  const body = object(value)
  if (
    body.version !== 1 ||
    !Array.isArray(body.entries) ||
    body.entries.length > 500 ||
    !Array.isArray(body.favoriteIds) ||
    body.favoriteIds.length > 600
  )
    throw new Error('命令库格式或版本不支持，请保留数据并重试')
  const entries = body.entries.map((raw) => {
    const entry = object(raw)
    const archivedAtMs = entry.archivedAtMs
    if (
      archivedAtMs !== null &&
      (typeof archivedAtMs !== 'number' || !Number.isSafeInteger(archivedAtMs) || archivedAtMs < 0)
    )
      throw new Error('归档时间无效')
    return {
      ...fields(entry),
      id: commandId(entry.id, true),
      archivedAtMs: archivedAtMs as number | null
    }
  })
  if (new Set(entries.map((entry) => entry.id)).size !== entries.length)
    throw new Error('命令引用重复')
  const favoriteIds = body.favoriteIds.map((id) => commandId(id))
  if (
    new Set(favoriteIds).size !== favoriteIds.length ||
    favoriteIds.some((id) => id.startsWith('user:') && !entries.some((entry) => entry.id === id))
  )
    throw new Error('收藏引用无效')
  const result: DeveloperCommandSnapshot = {
    version: 1,
    revision: revision(body.revision),
    entries,
    favoriteIds
  }
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > 2 * 1024 * 1024)
    throw new Error('命令库最多保存 2 MiB，请缩减记录内容')
  return result
}
