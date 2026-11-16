import {
  EXTENSION_SEARCH_LIMIT,
  EXTENSION_SEARCH_MAX_LIMIT,
  ExtensionError
} from '../../../shared/extensions'
import type {
  McpSearchInput,
  McpSearchItem,
  McpSearchResult,
  McpTransport
} from '../../../shared/extensions'

const REGISTRY_ENDPOINT = 'https://registry.modelcontextprotocol.io/v0/servers'
const TIMEOUT_MS = 12_000
const USER_AGENT = 'ToolBox/0.3 (+mcp-hub)'
const RUNTIME_TYPES = new Set(['npm', 'pypi', 'oci', 'nuget', 'mcpb'])
const TOKEN_PATTERN = /^[A-Za-z0-9@._:/-]+$/
const ENV_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/

const asObject = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}

const asText = (value: unknown): string => (typeof value === 'string' ? value : '')

const asList = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])

const clamp = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return EXTENSION_SEARCH_LIMIT
  return Math.min(EXTENSION_SEARCH_MAX_LIMIT, Math.max(1, Math.floor(value)))
}

function shortName(name: string): string {
  const last = name.split('/').filter(Boolean).pop() ?? name
  const cleaned = last.replace(/[^A-Za-z0-9._-]/g, '-').replace(/^-+|-+$/g, '')
  return cleaned || 'mcp-server'
}

function transportOf(pkg: Record<string, unknown>, remotes: unknown[]): McpTransport {
  const declared = asText(asObject(pkg['transport'])['type'])
  if (declared === 'stdio') return 'stdio'
  if (declared === 'sse') return 'sse'
  if (declared === 'streamable-http' || declared === 'http') return 'http'
  if (Object.keys(pkg).length) return 'stdio'
  return remotes.length ? 'http' : 'unknown'
}

/** 启动命令只拼经过白名单校验的片段，避免把不可信内容拼成可执行字符串。 */
function commandOf(pkg: Record<string, unknown>): string | null {
  const identifier = asText(pkg['identifier'])
  if (!identifier || !TOKEN_PATTERN.test(identifier)) return null
  const version = asText(pkg['version'])
  const type = asText(pkg['registryType'])
  const args = asList(pkg['runtimeArguments'])
    .map((item) => asText(asObject(item)['value']))
    .filter((value) => value && TOKEN_PATTERN.test(value))
  const typed = TOKEN_PATTERN.test(version) ? version : ''
  if (type === 'oci') return `docker run -i --rm ${identifier}${typed ? `:${typed}` : ''}`
  const runtime =
    asText(pkg['runtimeHint']) || (type === 'npm' ? 'npx' : type === 'pypi' ? 'uvx' : '')
  if (!runtime) return null
  const pinned =
    type === 'pypi'
      ? `${identifier}${typed ? `==${typed}` : ''}`
      : `${identifier}${typed ? `@${typed}` : ''}`
  const extra = type === 'npm' && !args.includes('-y') ? ['-y'] : []
  return [runtime, ...extra, ...args, pinned].join(' ')
}

function envNamesOf(pkg: Record<string, unknown>): string[] {
  return asList(pkg['environmentVariables'])
    .map((item) => asText(asObject(item)['name']))
    .filter((name) => ENV_PATTERN.test(name))
    .slice(0, 20)
}

function snippetOf(
  name: string,
  command: string | null,
  url: string | null,
  env: string[]
): string {
  const key = shortName(name)
  if (url) {
    return JSON.stringify({ mcpServers: { [key]: { type: 'http', url } } }, null, 2)
  }
  if (!command) return ''
  const [head, ...args] = command.split(' ')
  const server: Record<string, unknown> = { command: head }
  if (args.length) server['args'] = args
  if (env.length) server['env'] = Object.fromEntries(env.map((item) => [item, '<在此填写>']))
  return JSON.stringify({ mcpServers: { [key]: server } }, null, 2)
}

/**
 * 搜索官方 MCP Registry。
 *
 * 匿名可用、支持 `search` 与 `nextCursor` 分页；只取 `isLatest` 条目，
 * 命令与配置片段在本地生成，不把仓库里的任何文本当命令执行。
 */
export async function searchMcp(
  input: McpSearchInput,
  options: { fetchImpl?: typeof fetch } = {}
): Promise<McpSearchResult> {
  const query = input.query.trim().slice(0, 64)
  const limit = clamp(input.limit)
  const url = new URL(REGISTRY_ENDPOINT)
  if (query) url.searchParams.set('search', query)
  url.searchParams.set('limit', String(limit))
  if (input.cursor) url.searchParams.set('cursor', input.cursor.slice(0, 256))

  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  let response: Response
  try {
    response = await fetchImpl(url, {
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(TIMEOUT_MS)
    })
  } catch {
    throw new ExtensionError('无法连接 MCP Registry，请检查网络或代理后重试')
  }
  if (response.status === 429) throw new ExtensionError('MCP Registry 请求过于频繁，请稍后再试')
  if (!response.ok) throw new ExtensionError(`MCP Registry 暂时不可用（HTTP ${response.status}）`)

  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    throw new ExtensionError('MCP Registry 返回了无法解析的内容')
  }
  const body = asObject(payload)
  const items: McpSearchItem[] = []
  for (const value of asList(body['servers']).slice(0, limit)) {
    const wrapped = asObject(value)
    const server = asObject(wrapped['server'])
    const name = asText(server['name'])
    if (!name) continue
    const official = asObject(
      asObject(wrapped['_meta'])['io.modelcontextprotocol.registry/official']
    )
    if (official['isLatest'] === false) continue
    const packages = asList(server['packages'])
    const remotes = asList(server['remotes'])
    const pkg = asObject(packages[0])
    const registryType = asText(pkg['registryType'])
    const transport = transportOf(pkg, remotes)
    const remote = remotes.length ? asObject(remotes[0]) : {}
    const remoteUrl = asText(remote['url']) || null
    const command = transport === 'stdio' && RUNTIME_TYPES.has(registryType) ? commandOf(pkg) : null
    if (!command && !remoteUrl) continue
    const env = envNamesOf(pkg)
    items.push({
      name,
      title: (asText(server['title']) || name).slice(0, 120),
      description: asText(server['description']).replace(/\s+/g, ' ').slice(0, 400),
      version: asText(server['version']).slice(0, 40),
      transport,
      commandLine: command,
      configSnippet: snippetOf(name, command, remoteUrl, env),
      repositoryUrl: asText(asObject(server['repository'])['url']) || null,
      remoteUrl
    })
  }

  const metadata = asObject(body['metadata'])
  const nextCursor = asText(metadata['nextCursor']) || null
  return { query, items, nextCursor }
}
