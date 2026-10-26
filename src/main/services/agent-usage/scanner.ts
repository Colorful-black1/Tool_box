import { createReadStream } from 'node:fs'
import { lstat, readdir, readFile, stat } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import type { UsageClient, UsageSourceView } from '../../../shared/agent-usage'
import { UsageLogParser } from './jsonl-parser'
import { parseUsageJson } from './json-source'
import { readUsageDatabase } from './sqlite-source'
import type { UsageRecord } from './normalize'
import { decodeZstdFrames } from './zstd-frames'

interface FileSnapshot {
  client: UsageClient
  path: string
  fingerprint: string
  records: UsageRecord[]
  partial: boolean
}

/** 单次解析产物，不含身份与指纹。 */
type ParsedFile = Pick<FileSnapshot, 'records' | 'partial'>

/** 缓存文件里的单文件快照；只含统计元数据。 */
export type UsageFileSnapshot = FileSnapshot

const DB_CLIENTS = new Set<UsageClient>(['opencode', 'zcode', 'copilot', 'mimocode', 'mcode'])
const MAX_FILE_BYTES = 256 * 1024 * 1024
const MAX_LINE_BYTES = 8 * 1024 * 1024

function accepts(client: UsageClient, path: string): boolean {
  const name = basename(path)
  if (DB_CLIENTS.has(client)) return /\.(?:db|sqlite|sqlite3)$/.test(name)
  switch (client) {
    case 'kimi':
      return name === 'wire.jsonl'
    case 'dsh':
      return /^session(?:\.v[1-9]\d*)?\.jsonl(?:\.zstd)?$/.test(name)
    case 'grok':
      return name === 'usage.json'
    case 'cline':
      return name.endsWith('.messages.json')
    case 'gemini':
      return /\.(?:jsonl|json)$/.test(name) && path.split(/[\\/]/).includes('chats')
    default:
      return name.endsWith('.jsonl')
  }
}

/** 只遍历已知来源根目录，跳过符号链接、依赖和插件目录；深度和数量有上限。 */
async function discover(client: UsageClient, root: string, depth = 0): Promise<string[]> {
  const info = await lstat(root)
  if (info.isSymbolicLink()) return []
  if (info.isFile()) return accepts(client, root) ? [root] : []
  if (!info.isDirectory() || depth > 10) return []
  const found: string[] = []
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (
      entry.isSymbolicLink() ||
      ['node_modules', '.git', 'plugins', 'plugin-state', 'mirrors'].includes(entry.name)
    )
      continue
    const path = join(root, entry.name)
    if (entry.isFile() && accepts(client, path)) found.push(path)
    else if (entry.isDirectory()) found.push(...(await discover(client, path, depth + 1)))
    if (found.length > 30_000) throw new Error('source file limit')
  }
  return found
}

async function fingerprint(path: string, database: boolean): Promise<string> {
  const info = await stat(path)
  let value = `${info.dev}:${info.ino}:${info.size}:${info.mtimeMs}:${info.ctimeMs}`
  if (database) {
    try {
      const wal = await stat(path + '-wal')
      value += `:${wal.size}:${wal.mtimeMs}:${wal.ctimeMs}`
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      // 没有 WAL 的独立数据库仍是有效来源。
    }
  }
  return value
}

async function readLog(client: UsageClient, path: string): Promise<ParsedFile> {
  const parser = new UsageLogParser(client, path)
  const file = createReadStream(path)
  const decoder = new StringDecoder('utf8')
  const stream = path.endsWith('.zstd') ? decodeZstdFrames(file, true) : file
  let buffer = ''
  let bytes = 0
  let line = 0
  try {
    for await (const chunk of stream) {
      bytes += chunk.length
      if (bytes > MAX_FILE_BYTES) throw new Error('source size limit')
      buffer += decoder.write(chunk)
      let end: number
      while ((end = buffer.indexOf('\n')) >= 0) {
        const json = buffer.slice(0, end)
        buffer = buffer.slice(end + 1)
        line++
        if (!json.trim()) continue
        if (json.length > MAX_LINE_BYTES) {
          parser.issues++
          continue
        }
        try {
          parser.accept(JSON.parse(json) as unknown, line)
        } catch {
          // 损坏单行只影响本来源覆盖率；不输出原始记录或解析异常。
          parser.issues++
        }
      }
      if (buffer.length > MAX_LINE_BYTES) throw new Error('source line limit')
    }
    // 只提交已有换行的记录；末尾半行属于正常写入，不计数也不告警。
    // 补完后文件指纹会变化，下次扫描再读取，不会因缓存跳过新增记录。
    const records = parser.finish()
    const partial = parser.issues > 0
    return { records, partial }
  } finally {
    file.destroy()
  }
}

function selectDsh(paths: string[]): string[] {
  const selected = new Map<string, string>()
  const version = (p: string): number => Number(basename(p).match(/\.v(\d+)\./)?.[1] ?? 0)
  for (const path of paths.sort()) {
    const old = selected.get(dirname(path))
    if (
      !old ||
      version(path) > version(old) ||
      (version(path) === version(old) && old.endsWith('.zstd') && !path.endsWith('.zstd'))
    )
      selected.set(dirname(path), path)
  }
  return [...selected.values()]
}

/** 缓存只保留元数据；未变化的文件不重读，变化或截断的文件整份替换而非追加总量。 */
export class UsageScanner {
  private files = new Map<string, FileSnapshot>()

  /** 从落盘缓存恢复文件快照；下次扫描先比对指纹，未变化直接复用。 */
  seed(entries: UsageFileSnapshot[]): void {
    this.files.clear()
    for (const entry of entries) this.files.set(`${entry.client}:${entry.path}`, entry)
  }

  /** 导出当前快照供缓存写入；调用方只读，不参与扫描。 */
  snapshot(): UsageFileSnapshot[] {
    return [...this.files.values()].map((entry) => ({ ...entry, records: [...entry.records] }))
  }

  async scan(
    client: UsageClient,
    paths: string[],
    custom = false
  ): Promise<{ source: UsageSourceView; records: UsageRecord[] }> {
    const started = Date.now()
    const source: UsageSourceView = {
      client,
      paths,
      custom,
      status: 'missing',
      detail: '未找到本地记录',
      records: 0,
      durationMs: 0
    }
    const discovered = new Set<string>()
    let failures = 0
    let present = 0
    for (const path of paths) {
      try {
        for (const file of await discover(client, path)) discovered.add(file)
        present++
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') failures++
      }
    }
    const files = client === 'dsh' ? selectDsh([...discovered]) : [...discovered].sort()
    const activeFiles = new Set(files.map((p) => `${client}:${p}`))
    let partial = failures > 0
    const records: UsageRecord[] = []
    for (const path of files) {
      const key = `${client}:${path}`
      const previous = this.files.get(key)
      const database = DB_CLIENTS.has(client)
      let before: string | undefined
      let changing = false
      try {
        before = await fingerprint(path, database)
        if (previous?.fingerprint === before && !previous.partial) {
          for (const record of previous.records) records.push(record)
          partial ||= previous.records.some((r) => r.partial)
          continue
        }
        let parsed: ParsedFile
        if (database) parsed = { records: await readUsageDatabase(client, path), partial: false }
        else if (extname(path) === '.json') {
          if ((await stat(path)).size > 32 * 1024 * 1024) throw new Error('source json limit')
          parsed = {
            records: parseUsageJson(
              client,
              path,
              JSON.parse(await readFile(path, 'utf8')) as unknown
            ),
            partial: false
          }
        } else parsed = await readLog(client, path)
        changing = (await fingerprint(path, database)) !== before
        if (!changing) {
          this.files.set(key, { client, path, ...parsed, fingerprint: before })
          for (const record of parsed.records) records.push(record)
          partial ||= parsed.partial || parsed.records.some((r) => r.partial)
          continue
        }
      } catch {
        // 写入也可能先导致解析失败；仅在指纹确实变化时按正常写入暂缓。
        if (before !== undefined) {
          try {
            changing = (await fingerprint(path, database)) !== before
          } catch {
            // 无法确认仍在写入，保留真实读取失败，不能静默隐藏权限或文件错误。
          }
        }
      }
      // 本次读到变化中的文件时不提交、不覆盖缓存；下次稳定后再替换确认值。
      // 已有的不完整标记继续保留，写入状态不能掩盖历史缺失。
      if (!changing) failures++
      if (previous) {
        for (const record of previous.records)
          records.push(changing ? record : { ...record, partial: true })
        partial ||= previous.partial || previous.records.some((r) => r.partial)
      }
    }
    // 文件删除、路径变更或压缩代际替换后不让旧缓存继续参加统计。
    for (const key of this.files.keys())
      if (key.startsWith(client + ':') && !activeFiles.has(key)) this.files.delete(key)
    source.records = records.length
    source.status =
      failures && !records.length
        ? 'error'
        : failures || partial
          ? 'partial'
          : records.length
            ? 'ready'
            : present
              ? 'empty'
              : 'missing'
    source.detail =
      source.status === 'ready'
        ? '已读取本地用量'
        : source.status === 'partial'
          ? '部分记录读取失败或字段不完整，显示已知用量'
          : source.status === 'error'
            ? '无法读取或格式不兼容，请核对数据目录与工具版本'
            : source.status === 'empty'
              ? '目录存在，尚无可识别的用量记录'
              : source.detail
    source.durationMs = Date.now() - started
    return { source, records }
  }
}
