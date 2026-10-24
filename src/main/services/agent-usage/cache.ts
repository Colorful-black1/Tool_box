import { readFile, rename, writeFile } from 'node:fs/promises'
import { USAGE_CLIENTS } from '../../../shared/agent-usage'
import type { UsageClient, UsageSourceView, UsageTokens } from '../../../shared/agent-usage'
import type { UsageFileSnapshot } from './scanner'
import type { UsageRecord } from './normalize'

/** 缓存版本随记录结构变化；不匹配时丢弃旧文件，回退到全量扫描。 */
export const USAGE_CACHE_VERSION = 1
const MAX_CACHE_BYTES = 64 * 1024 * 1024
const MAX_RECORDS = 200_000
const SOURCE_STATUS = new Set(['ready', 'missing', 'empty', 'partial', 'error'])

export interface UsageCache {
  version: number
  scannedAt: number
  sources: UsageSourceView[]
  files: UsageFileSnapshot[]
}

const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}

const text = (value: unknown): string | null => (typeof value === 'string' ? value : null)

const nullableNumber = (value: unknown): number | null | undefined => {
  if (value === null) return null
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function clientValue(value: unknown): UsageClient | null {
  return typeof value === 'string' && Object.hasOwn(USAGE_CLIENTS, value)
    ? (value as UsageClient)
    : null
}

function tokensValue(value: unknown): UsageTokens | null {
  const raw = object(value)
  const keys = ['input', 'output', 'cacheRead', 'cacheWrite', 'reasoning', 'total'] as const
  const tokens = {} as UsageTokens
  for (const key of keys) {
    const parsed = nullableNumber(raw[key])
    if (parsed === undefined) return null
    tokens[key] = parsed
  }
  return tokens
}

function recordValue(value: unknown): UsageRecord | null {
  const raw = object(value)
  const client = clientValue(raw.client)
  const sessionId = text(raw.sessionId)
  const id = text(raw.id)
  const project = text(raw.project)
  const model = text(raw.model)
  const tokens = tokensValue(raw.tokens)
  const time = nullableNumber(raw.time)
  const costUsd = nullableNumber(raw.costUsd)
  const requests = nullableNumber(raw.requests)
  if (
    !client ||
    sessionId === null ||
    id === null ||
    project === null ||
    model === null ||
    !tokens ||
    time === undefined ||
    costUsd === undefined ||
    requests === undefined ||
    typeof raw.partial !== 'boolean'
  )
    return null
  return {
    client,
    sessionId,
    id,
    project,
    model,
    time,
    tokens,
    costUsd,
    requests,
    partial: raw.partial,
    ...(typeof raw.snapshot === 'boolean' ? { snapshot: raw.snapshot } : {})
  }
}

function sourceValue(value: unknown): UsageSourceView | null {
  const raw = object(value)
  const client = clientValue(raw.client)
  const status = text(raw.status)
  const detail = text(raw.detail)
  const records = nullableNumber(raw.records)
  const durationMs = nullableNumber(raw.durationMs)
  if (
    !client ||
    !status ||
    !SOURCE_STATUS.has(status) ||
    detail === null ||
    records === null ||
    records === undefined ||
    durationMs === null ||
    durationMs === undefined ||
    !Array.isArray(raw.paths) ||
    !raw.paths.every((path) => typeof path === 'string') ||
    typeof raw.custom !== 'boolean'
  )
    return null
  return {
    client,
    paths: raw.paths as string[],
    custom: raw.custom,
    status: status as UsageSourceView['status'],
    detail,
    records,
    durationMs
  }
}

function fileValue(value: unknown): UsageFileSnapshot | null {
  const raw = object(value)
  const client = clientValue(raw.client)
  const path = text(raw.path)
  const fingerprint = text(raw.fingerprint)
  if (
    !client ||
    path === null ||
    fingerprint === null ||
    typeof raw.partial !== 'boolean' ||
    !Array.isArray(raw.records)
  )
    return null
  const records: UsageRecord[] = []
  for (const entry of raw.records) {
    const record = recordValue(entry)
    if (!record) return null
    records.push(record)
    if (records.length > MAX_RECORDS) return null
  }
  return { client, path, fingerprint, partial: raw.partial, records }
}

/** 读取失败、版本不符或结构损坏都返回 null，由调用方重新扫描，不阻塞统计。 */
export async function readUsageCache(file: string): Promise<UsageCache | null> {
  try {
    const text = await readFile(file, 'utf8')
    if (text.length > MAX_CACHE_BYTES) return null
    const data = object(JSON.parse(text) as unknown)
    if (data.version !== USAGE_CACHE_VERSION) return null
    const scannedAt = nullableNumber(data.scannedAt)
    if (scannedAt === null || scannedAt === undefined || scannedAt <= 0) return null
    const sources = Array.isArray(data.sources)
      ? data.sources.map(sourceValue).filter((item): item is UsageSourceView => Boolean(item))
      : []
    const files = Array.isArray(data.files)
      ? data.files.map(fileValue).filter((item): item is UsageFileSnapshot => Boolean(item))
      : []
    if (!sources.length && !files.length) return null
    return { version: USAGE_CACHE_VERSION, scannedAt, sources, files }
  } catch {
    // 文件缺失、被其他进程占用或不是合法 JSON：当作没有缓存。
    return null
  }
}

/** 只写统计元数据；超限时放弃写入而不是截断，避免界面显示被截断的历史。 */
export async function writeUsageCache(
  file: string,
  cache: UsageCache,
  limit = MAX_CACHE_BYTES
): Promise<boolean> {
  const payload = JSON.stringify({ ...cache, version: USAGE_CACHE_VERSION })
  const bytes = Buffer.byteLength(payload, 'utf8')
  if (bytes > limit) {
    console.warn('[AgentUsage] 统计缓存超过上限，本次不写入', { bytes })
    return false
  }
  await writeFile(`${file}.tmp`, payload, { encoding: 'utf8', mode: 0o600 })
  await rename(`${file}.tmp`, file)
  return true
}
