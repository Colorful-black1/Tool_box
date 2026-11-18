import { MEMORY_KINDS, MEMORY_LIMITS, MEMORY_STATUSES } from '../../../shared/types'
import type {
  MemoryExportFormat,
  MemoryItemView,
  MemoryKind,
  MemoryStatus
} from '../../../shared/types'

export const MEMORY_EXPORT_VERSION = 1

const MAX_IMPORT_ITEMS = 2_000

/** 可落库的导入草稿；来源字段不跨机迁移，统一清空。 */
export interface MemoryImportItem {
  kind: MemoryKind
  title: string
  body: string
  tags: string[]
  pinned: boolean
  status: MemoryStatus
  confidence: number
  expiresAtMs: number | null
}

/**
 * 导出 JSON / Markdown。
 *
 * JSON 是唯一可恢复格式，包含正文、状态、置信度、置顶与到期时间；
 * 不带来源会话 id，避免把本机数据库标识带到另一台机器。
 */
export function serializeMemoryExport(
  items: readonly MemoryItemView[],
  format: MemoryExportFormat
): string {
  if (format === 'markdown') return toMarkdown(items)
  return JSON.stringify(
    {
      version: MEMORY_EXPORT_VERSION,
      exportedAt: new Date().toISOString(),
      items: items.map((item) => ({
        kind: item.kind,
        title: item.title,
        body: item.body,
        tags: item.tags,
        pinned: item.pinned,
        status: item.status,
        confidence: item.confidence,
        createdAtMs: item.createdAtMs,
        updatedAtMs: item.updatedAtMs,
        expiresAtMs: item.expiresAtMs,
        sourceExcerpt: item.sourceExcerpt
      }))
    },
    null,
    2
  )
}

/** 解析导出的 JSON；坏文件、非数组、超量都拒绝，单条非法项跳过。 */
export function parseMemoryExport(text: string): MemoryImportItem[] {
  const trimmed = text.trim()
  if (!trimmed) throw new Error('导入文件为空')
  if (trimmed.startsWith('#')) throw new Error('Markdown 导出仅供阅读，请选择 JSON 文件导入')

  let value: unknown
  try {
    value = JSON.parse(trimmed)
  } catch {
    throw new Error('导入文件不是有效的 JSON')
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error('导入文件结构不正确')
  const record = value as Record<string, unknown>
  if (record.version !== MEMORY_EXPORT_VERSION) throw new Error('导入文件版本不受支持')
  if (!Array.isArray(record.items)) throw new Error('导入文件缺少记忆列表')
  if (record.items.length > MAX_IMPORT_ITEMS)
    throw new Error(`一次最多导入 ${MAX_IMPORT_ITEMS} 条记忆`)

  const items: MemoryImportItem[] = []
  for (const entry of record.items) {
    if (typeof entry !== 'object' || entry === null) continue
    const item = entry as Record<string, unknown>
    if (typeof item.kind !== 'string' || !(MEMORY_KINDS as readonly string[]).includes(item.kind))
      continue
    if (typeof item.title !== 'string' || typeof item.body !== 'string') continue
    const title = item.title.replace(/\s+/g, ' ').trim()
    const body = item.body.replace(/\r\n?/g, '\n').trim()
    if (!title || !body) continue
    if (title.length > MEMORY_LIMITS.title || body.length > MEMORY_LIMITS.body) continue
    const status = MEMORY_STATUSES.find((value) => value === item.status)
    if (!status) continue
    const tags = Array.isArray(item.tags)
      ? item.tags
          .filter((tag): tag is string => typeof tag === 'string')
          .map((tag) => tag.trim())
          .filter(Boolean)
          .slice(0, MEMORY_LIMITS.tags)
      : []
    const expiresAtMs =
      typeof item.expiresAtMs === 'number' && Number.isSafeInteger(item.expiresAtMs)
        ? item.expiresAtMs
        : null
    const confidence =
      typeof item.confidence === 'number' && Number.isFinite(item.confidence)
        ? Math.min(1, Math.max(0, item.confidence))
        : 0.5
    items.push({
      kind: item.kind as MemoryKind,
      title,
      body,
      tags,
      pinned: item.pinned === true,
      status,
      confidence,
      expiresAtMs
    })
  }
  return items
}

function toMarkdown(items: readonly MemoryItemView[]): string {
  const lines = [
    '# 助手长期记忆',
    '',
    `> 导出时间：${new Date().toLocaleString('zh-CN')}。本文件仅供阅读，导入请使用 JSON 导出。`,
    ''
  ]
  const order = MEMORY_KINDS
  for (const kind of order) {
    const group = items.filter((item) => item.kind === kind)
    if (group.length === 0) continue
    lines.push(`## ${kindLabel(kind)}`, '')
    for (const item of group) {
      lines.push(`### ${item.title}`, '', item.body, '')
      const meta = [
        `状态：${statusLabel(item.status)}`,
        `置信度：${item.confidence.toFixed(2)}`,
        item.pinned ? '置顶：是' : '',
        item.tags.length > 0 ? `标签：${item.tags.join('、')}` : ''
      ].filter(Boolean)
      lines.push(meta.map((entry) => `- ${entry}`).join('\n'), '')
    }
  }
  return lines.join('\n').trimEnd() + '\n'
}

const KIND_LABELS: Record<MemoryKind, string> = {
  preference: '偏好',
  profile: '画像',
  constraint: '约束',
  procedural: '流程',
  episodic: '事件'
}

const STATUS_LABELS: Record<MemoryStatus, string> = {
  pending: '待确认',
  active: '生效',
  archived: '已归档',
  rejected: '已拒绝'
}

function kindLabel(kind: MemoryKind): string {
  return KIND_LABELS[kind]
}

function statusLabel(status: MemoryStatus): string {
  return STATUS_LABELS[status]
}
