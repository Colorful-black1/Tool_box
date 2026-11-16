import { open, realpath } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

import type {
  ExtensionAgentId,
  ExtensionSourceStatus,
  ExtensionSourceView,
  McpEntryView,
  McpScanResult,
  McpTransport
} from '../../../shared/extensions'
import { parseMcpJson } from '../coding-agents/local-mcp-catalog'
import { displayPath } from './skill-scan'

const MAX_FILE_BYTES = 2 * 1024 * 1024
const MAX_ENTRIES_PER_SOURCE = 100
const MAX_PROJECTS = 20

interface McpSourceSpec {
  id: string
  label: string
  agent: ExtensionAgentId
  file: string
  /** 同一来源可能有多个候选文件（如 opencode.json / opencode.jsonc）。 */
  alternates?: string[]
  parser: (text: string) => RawEntry[]
}

export interface RawEntry {
  name: string
  transport: McpTransport
  command: string | null
  argCount: number | null
  urlHost: string | null
  envKeys: string[]
  headerKeys: string[]
  enabled: boolean
  /** 同一文件里的不同作用域（目前只有 Claude 的项目级 mcpServers）。 */
  scope?: string
}

const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}

const text = (value: unknown): string => (typeof value === 'string' ? value : '')

const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])

const baseName = (value: string): string => value.split(/[\\/]/).filter(Boolean).pop() ?? value

const hostOf = (value: string): string | null => {
  try {
    return new URL(value).host || null
  } catch {
    return null
  }
}

const validName = (value: string): boolean =>
  Boolean(value) && value.length <= 120 && !/[\r\n\0]/.test(value)

function transportOf(value: Record<string, unknown>): McpTransport {
  const declared = text(value.type) || text(value.transport)
  if (declared === 'stdio' || declared === 'local') return 'stdio'
  if (declared === 'http' || declared === 'streamable-http' || declared === 'remote') return 'http'
  if (declared === 'sse') return 'sse'
  if (text(value.url)) return 'http'
  if (text(value.command) || list(value.command).length) return 'stdio'
  return 'unknown'
}

/** 通用条目解析：覆盖 claude / cursor / gemini / vscode / claude-desktop / opencode 的字段差异。 */
function describeEntry(value: unknown): RawEntry | null {
  const config = object(value)
  const commandValue = config.command
  const command = Array.isArray(commandValue) ? text(commandValue[0]) : text(commandValue)
  const args = Array.isArray(commandValue) ? commandValue.slice(1) : list(config.args)
  const env = object(config.env ?? config.environment)
  const headers = object(config.headers)
  const url = text(config.url)
  if (!url && !command) return null
  return {
    name: '',
    transport: transportOf(config),
    command: command ? baseName(command) : null,
    argCount: args.length,
    urlHost: url ? hostOf(url) : null,
    envKeys: Object.keys(env).slice(0, 50),
    headerKeys: Object.keys(headers).slice(0, 50),
    enabled: config.enabled !== false && config.disabled !== true
  }
}

function entriesFromServers(servers: unknown): RawEntry[] {
  const result: RawEntry[] = []
  for (const [name, value] of Object.entries(object(servers)).slice(0, MAX_ENTRIES_PER_SOURCE)) {
    if (!validName(name)) continue
    const entry = describeEntry(value)
    if (entry) result.push({ ...entry, name })
  }
  return result
}

/** Claude Code：全局 mcpServers + 每个项目的 mcpServers（只取前 20 个项目）。 */
export function parseClaudeMcp(text: string): RawEntry[] {
  const data = object(parseMcpJson(text))
  const result = entriesFromServers(data.mcpServers ?? data.mcp)
  const projects = object(data.projects)
  for (const [dir, value] of Object.entries(projects).slice(0, MAX_PROJECTS)) {
    const scope = dir.split(/[\\/]/).filter(Boolean).pop() ?? dir
    for (const entry of entriesFromServers(object(value).mcpServers))
      result.push({ ...entry, scope })
  }
  return result
}

/** OpenCode：`mcp` 下 local/remote 两种，command 是数组。 */
export function parseOpenCodeMcp(text: string): RawEntry[] {
  const data = object(parseMcpJson(text))
  return entriesFromServers(data.mcp ?? data.mcpServers)
}

/** VS Code：用户级 mcp.json 用 `servers` 键。 */
export function parseVsCodeMcp(text: string): RawEntry[] {
  const data = object(parseMcpJson(text))
  return entriesFromServers(data.servers ?? data.mcpServers)
}

/** 通用 JSON（cursor / gemini / claude desktop）：`mcpServers`。 */
export function parseGenericMcp(text: string): RawEntry[] {
  const data = object(parseMcpJson(text))
  return entriesFromServers(data.mcpServers ?? data.mcp ?? data.servers)
}

/** Codex：只认 `[mcp_servers.<name>]` 与它的 `.env` 子表。 */
export function parseCodexMcp(text: string): RawEntry[] {
  const result: RawEntry[] = []
  let current: RawEntry | null = null
  let section: 'main' | 'env' | 'none' = 'none'
  const flush = (): void => {
    if (current) result.push(current)
    current = null
  }
  for (const line of text.split(/\r?\n/)) {
    const header =
      /^\s*\[\s*mcp_servers\s*\.\s*("(?:[^"\\]|\\.)*"|'[^']*'|[\w-]+)\s*(\.\s*([\w-]+)\s*)?\]\s*(?:#.*)?$/.exec(
        line
      )
    if (header) {
      const name = header[1].startsWith('"')
        ? (() => {
            try {
              return JSON.parse(header[1]) as string
            } catch {
              return ''
            }
          })()
        : header[1].replace(/^'|'$/g, '')
      if (!validName(name)) {
        flush()
        section = 'none'
        continue
      }
      if (header[3] === 'env') {
        section = current && current.name === name ? 'env' : 'none'
        continue
      }
      if (header[3] && header[3] !== 'env') {
        section = 'none'
        continue
      }
      flush()
      current = {
        name,
        transport: 'stdio',
        command: null,
        argCount: null,
        urlHost: null,
        envKeys: [],
        headerKeys: [],
        enabled: true
      }
      section = 'main'
      continue
    }
    if (/^\s*\[/.test(line)) {
      section = 'none'
      continue
    }
    if (!current) continue
    if (section === 'env') {
      const key = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line)
      if (key && current.envKeys.length < 50) current.envKeys.push(key[1])
      continue
    }
    if (section !== 'main') continue
    const command = /^\s*command\s*=\s*("(?:[^"\\]|\\.)*"|'[^']*')\s*(?:#.*)?$/.exec(line)
    if (command) {
      const raw = command[1].startsWith('"')
        ? (() => {
            try {
              return JSON.parse(command[1]) as string
            } catch {
              return ''
            }
          })()
        : command[1].slice(1, -1)
      current.command = raw ? baseName(raw) : null
      current.transport = 'stdio'
      continue
    }
    const args = /^\s*args\s*=\s*\[(.*)\]\s*(?:#.*)?$/.exec(line)
    if (args) {
      current.argCount = (args[1].match(/"(?:[^"\\]|\\.)*"|'[^']*'/g) ?? []).length
      continue
    }
    const url = /^\s*url\s*=\s*("(?:[^"\\]|\\.)*"|'[^']*')\s*(?:#.*)?$/.exec(line)
    if (url) {
      const raw = url[1].slice(1, -1)
      current.urlHost = hostOf(raw)
      current.transport = raw ? 'http' : current.transport
      continue
    }
    if (/^\s*enabled\s*=\s*false\s*(?:#.*)?$/.test(line)) current.enabled = false
  }
  flush()
  return result.slice(0, MAX_ENTRIES_PER_SOURCE)
}

/**
 * DSH：`cordis.patch.yml` 里 `@deepseek-ai/dsh-mcp-client` 插件条目。
 *
 * 没有 YAML 依赖，只认这一种块结构：块首 `- id:`，块内 `config.serverName` /
 * `transport` / `command` / `args` / `env`。结构不符就跳过，不影响其他来源。
 */
export function parseDshMcp(text: string): RawEntry[] {
  const lines = text.split(/\r?\n/)
  const blocks: string[][] = []
  let block: string[] | null = null
  for (const line of lines) {
    if (/^-\s/.test(line)) {
      if (block) blocks.push(block)
      block = [line]
    } else if (block) block.push(line)
  }
  if (block) blocks.push(block)

  const result: RawEntry[] = []
  for (const lines of blocks) {
    if (!lines.some((line) => /name:\s*["']?@deepseek-ai\/dsh-mcp-client["']?/.test(line))) continue
    const body = lines.join('\n')
    const name = /serverName:\s*["']?([\w.-]+)["']?/.exec(body)?.[1]
    if (!name || !validName(name)) continue
    const transportText = /transport:\s*["']?([\w-]+)["']?/.exec(body)?.[1] ?? 'stdio'
    const command = /^\s+command:\s*["']?(.+?)["']?\s*$/m.exec(body)?.[1]
    const url = /^\s+url:\s*["']?(.+?)["']?\s*$/m.exec(body)?.[1]
    // 只按缩进读 args / env 的值；同级或更浅的键（如 toolCallTimeoutMs）必须停止。
    const indentOf = (line: string): number => line.length - line.trimStart().length
    let argCount: number | null = null
    let argsIndent = -1
    let envIndent = -1
    const envKeys: string[] = []
    for (const line of lines) {
      if (!line.trim()) continue
      const indent = indentOf(line)
      if (argsIndent >= 0) {
        if (indent > argsIndent) {
          if (line.trim().startsWith('-')) argCount = (argCount ?? 0) + 1
          continue
        }
        argsIndent = -1
      }
      if (envIndent >= 0) {
        if (indent > envIndent) {
          const key = /^([A-Za-z_][A-Za-z0-9_]*)\s*:/.exec(line.trim())
          if (key) envKeys.push(key[1])
          continue
        }
        envIndent = -1
      }
      if (/^\s+args:\s*$/.test(line)) {
        argsIndent = indent
        argCount = 0
        continue
      }
      if (/^\s+env:\s*$/.test(line)) envIndent = indent
    }
    result.push({
      name,
      transport: transportText === 'stdio' ? 'stdio' : url ? 'http' : 'unknown',
      command: command ? baseName(command.replace(/^['"]|['"]$/g, '')) : null,
      argCount,
      urlHost: url ? hostOf(url.replace(/^['"]|['"]$/g, '')) : null,
      envKeys: envKeys.slice(0, 50),
      headerKeys: [],
      enabled: !/disabled:\s*true/.test(body)
    })
  }
  return result.slice(0, MAX_ENTRIES_PER_SOURCE)
}

function appData(env: NodeJS.ProcessEnv, home: string): string {
  if (env['APPDATA']) return env['APPDATA']
  return process.platform === 'darwin'
    ? join(home, 'Library', 'Application Support')
    : join(home, '.config')
}

function buildSources(home: string, env: NodeJS.ProcessEnv): McpSourceSpec[] {
  const config = env['XDG_CONFIG_HOME'] || join(home, '.config')
  const roaming = appData(env, home)
  return [
    {
      id: 'claude',
      label: 'Claude Code',
      agent: 'claude',
      file: join(home, '.claude.json'),
      parser: parseClaudeMcp
    },
    {
      id: 'codex',
      label: 'Codex',
      agent: 'codex',
      file: join(home, '.codex', 'config.toml'),
      parser: parseCodexMcp
    },
    {
      id: 'opencode',
      label: 'OpenCode',
      agent: 'opencode',
      file: join(config, 'opencode', 'opencode.json'),
      alternates: [join(config, 'opencode', 'opencode.jsonc')],
      parser: parseOpenCodeMcp
    },
    {
      id: 'dsh-web',
      label: 'DSH（web profile）',
      agent: 'dsh',
      file: join(home, '.dsh', 'profiles', 'web', 'cordis.patch.yml'),
      parser: parseDshMcp
    },
    {
      id: 'dsh-desktop',
      label: 'DSH（desktop profile）',
      agent: 'dsh',
      file: join(home, '.dsh', 'profiles', 'desktop', 'cordis.patch.yml'),
      parser: parseDshMcp
    },
    {
      id: 'claude-desktop',
      label: 'Claude Desktop',
      agent: 'claude-desktop',
      file: join(roaming, 'Claude', 'claude_desktop_config.json'),
      parser: parseGenericMcp
    },
    {
      id: 'gemini',
      label: 'Gemini CLI',
      agent: 'gemini',
      file: join(home, '.gemini', 'settings.json'),
      parser: parseGenericMcp
    },
    {
      id: 'cursor',
      label: 'Cursor',
      agent: 'cursor',
      file: join(home, '.cursor', 'mcp.json'),
      parser: parseGenericMcp
    },
    {
      id: 'vscode',
      label: 'VS Code',
      agent: 'vscode',
      file: join(roaming, 'Code', 'mcp.json'),
      parser: parseVsCodeMcp
    }
  ]
}

const SOURCE_DETAIL: Record<ExtensionSourceStatus, string> = {
  ready: '已读取',
  empty: '配置存在，但没有 MCP',
  missing: '未发现该配置文件',
  error: '配置无法解析',
  partial: '部分读取'
}

function statusOf(count: number, exists: boolean, failed: boolean): ExtensionSourceStatus {
  if (!exists) return 'missing'
  if (failed) return 'error'
  return count ? 'ready' : 'empty'
}

async function readConfig(
  file: string
): Promise<{ text: string; exists: boolean; failed: boolean }> {
  let handle: Awaited<ReturnType<typeof open>> | undefined
  try {
    handle = await open(file, 'r')
    const info = await handle.stat()
    if (!info.isFile() || info.size > MAX_FILE_BYTES)
      return { text: '', exists: true, failed: true }
    const buffer = Buffer.alloc(Number(info.size))
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
    return { text: buffer.subarray(0, bytesRead).toString('utf8'), exists: true, failed: false }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    return { text: '', exists: code !== 'ENOENT', failed: code !== 'ENOENT' }
  } finally {
    await handle?.close()
  }
}

/**
 * 扫描本机 MCP 配置。
 *
 * 只回可展示字段：命令只看可执行名，env / headers 只看键名；值不进视图对象。
 */
export async function scanMcp(
  options: { home?: string; env?: NodeJS.ProcessEnv } = {}
): Promise<McpScanResult> {
  const home = options.home ?? homedir()
  const env = options.env ?? process.env
  const sources: ExtensionSourceView[] = []
  const entries: Array<Omit<McpEntryView, 'conflict'>> = []
  const notices: string[] = []

  for (const spec of buildSources(home, env)) {
    const candidates = [spec.file, ...(spec.alternates ?? [])]
    let used: string | null = null
    let parsed: RawEntry[] = []
    let failed = false
    let exists = false
    for (const candidate of candidates) {
      const read = await readConfig(candidate)
      if (!read.exists) continue
      exists = true
      used = candidate
      if (read.failed) {
        failed = true
        continue
      }
      try {
        parsed = spec.parser(read.text)
        failed = false
      } catch {
        failed = true
      }
      break
    }
    const actual = used ?? spec.file
    const display = displayPath(home, actual)
    if (failed) notices.push(`${spec.label} 的 MCP 配置无法解析，已跳过。`)
    for (const entry of parsed) {
      const label = entry.scope ? `${spec.label}（${entry.scope}）` : spec.label
      const entryDisplay = entry.scope ? `${display} · ${entry.scope}` : display
      entries.push({
        name: entry.name,
        transport: entry.transport,
        command: entry.command,
        argCount: entry.argCount,
        urlHost: entry.urlHost,
        envKeys: entry.envKeys,
        headerKeys: entry.headerKeys,
        enabled: entry.enabled,
        agent: spec.agent,
        sourceId: spec.id,
        sourceLabel: label,
        sourceDisplay: entryDisplay
      })
    }
    const status = statusOf(parsed.length, exists, failed)
    sources.push({
      id: spec.id,
      label: spec.label,
      path: used ? await realpath(used).catch(() => used) : actual,
      displayPath: display,
      count: parsed.length,
      status,
      detail: SOURCE_DETAIL[status]
    })
  }

  // 同名服务可能存在于多个 Agent：启动方式不同的标冲突，界面提示分别核对。
  const byName = new Map<string, Array<Omit<McpEntryView, 'conflict'>>>()
  for (const entry of entries) {
    const list = byName.get(entry.name) ?? []
    list.push(entry)
    byName.set(entry.name, list)
  }
  const servers: McpEntryView[] = []
  for (const group of byName.values()) {
    const signatures = new Set(
      group.map((item) => [item.transport, item.command, item.argCount, item.urlHost].join('|'))
    )
    const conflict = signatures.size > 1
    for (const item of group) servers.push({ ...item, conflict })
  }
  servers.sort((a, b) => a.name.localeCompare(b.name) || a.sourceId.localeCompare(b.sourceId))

  return { servers, sources, scannedAt: new Date().toISOString(), notices }
}
