import { open, realpath } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { CodingAgentId } from '../../../shared/coding-agents'
import type { NativeAgentCatalog } from './agent-action-catalog'

/** 只处理 JSONC 的注释和尾逗号，不解释字符串里的脚本，不用 eval。 */
export function parseMcpJson(text: string): Record<string, unknown> {
  let result = '',
    quoted = false,
    escaped = false
  for (let i = 0; i < text.length; i++) {
    const char = text[i],
      next = text[i + 1]
    if (quoted) {
      result += char
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') quoted = false
    } else if (char === '"') {
      quoted = true
      result += char
    } else if (char === '/' && next === '/') {
      while (i + 1 < text.length && text[i + 1] !== '\n') i++
      result += ' '
    } else if (char === '/' && next === '*') {
      const end = text.indexOf('*/', i + 2)
      if (end < 0) throw new Error('配置注释未结束')
      i = end + 1
      result += ' '
    } else result += char
  }
  // 先完整去注释，再处理尾逗号，兼容逗号与结束括号之间仍有注释的写法。
  let cleaned = ''
  quoted = false
  escaped = false
  for (let i = 0; i < result.length; i++) {
    const char = result[i]
    if (quoted) {
      cleaned += char
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') quoted = false
    } else if (char === '"') {
      quoted = true
      cleaned += char
    } else if (char !== ',' || !/^\s*[}\]]/.test(result.slice(i + 1))) cleaned += char
  }
  const data: unknown = JSON.parse(cleaned.replace(/^\uFEFF/, ''))
  return object(data)
}
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
const validName = (value: string): boolean =>
  Boolean(value) && value.length <= 120 && !/[\r\n\0]/.test(value)

/** TOML 只识别服务顶层表与 enabled；env／headers 子表不能冒充另一台 MCP 服务。 */
export function configuredMcpToml(text: string): Array<{ name: string; enabled: boolean }> {
  const servers = new Map<string, boolean>()
  let current = ''
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*\[/.test(line)) {
      current = ''
      const match =
        /^\s*\[\s*mcp_servers\s*\.\s*("(?:[^"\\]|\\.)*"|'[^']*'|[\w-]+)\s*\]\s*(?:#.*)?$/.exec(line)
      if (!match) continue
      try {
        current = match[1].startsWith('"')
          ? (JSON.parse(match[1]) as string)
          : match[1].replace(/^'|'$/g, '')
      } catch {
        continue
      } // 不支持的 TOML 转义只跳过元数据，不猜服务名。
      if (validName(current)) servers.set(current, true)
      else current = ''
    } else if (current && /^\s*enabled\s*=\s*false\s*(?:#.*)?$/.test(line))
      servers.set(current, false)
  }
  return [...servers].map(([name, enabled]) => ({ name, enabled }))
}

/** 仅投影 MCP 名称和配置开关；不连接服务，不返回 command、URL、env、headers 或认证。 */
export async function discoverConfiguredMcp(
  id: CodingAgentId,
  directory: string,
  home = homedir(),
  env: NodeJS.ProcessEnv = process.env
): Promise<{ mcp: NativeAgentCatalog['mcp']; notices: string[] }> {
  if (!(await realpath(directory).catch(() => ''))) return { mcp: [], notices: [] }
  const files =
    id === 'codex'
      ? [join(env.CODEX_HOME || join(home, '.codex'), 'config.toml')]
      : id === 'opencode'
        ? ['opencode.json', 'opencode.jsonc'].flatMap((name) => [
            join(env.XDG_CONFIG_HOME || join(home, '.config'), 'opencode', name),
            join(directory, name),
            join(directory, '.opencode', name)
          ])
        : id === 'claude' || id === 'claude-desktop'
          ? [...(id === 'claude' ? [join(home, '.claude.json')] : []), join(directory, '.mcp.json')]
          : []
  const mcp = new Map<string, NativeAgentCatalog['mcp'][number]>()
  let failed = false
  for (const file of files) {
    let handle: Awaited<ReturnType<typeof open>> | undefined
    try {
      handle = await open(file, 'r')
      const info = await handle.stat()
      if (!info.isFile() || info.size > 2 * 1024 * 1024) {
        failed = true
        continue
      }
      const buffer = Buffer.alloc(info.size + 1)
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
      if (bytesRead > 2 * 1024 * 1024) {
        failed = true
        continue
      }
      const text = buffer.subarray(0, bytesRead).toString('utf8')
      let entries: Array<{ name: string; enabled: boolean }>
      if (file.endsWith('.toml')) entries = configuredMcpToml(text)
      else {
        const data = parseMcpJson(text)
        const project = object(object(data.projects)[directory])
        const configured = { ...object(data.mcpServers ?? data.mcp), ...object(project.mcpServers) }
        entries = Object.entries(configured).map(([name, value]) => ({
          name,
          enabled: object(value).enabled !== false && object(value).disabled !== true
        }))
      }
      for (const entry of entries.slice(0, 100))
        if (validName(entry.name))
          mcp.set(entry.name, {
            name: entry.name,
            status: entry.enabled ? '仅发现配置 · 未验证连接' : '本机配置已禁用',
            tools: []
          })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') failed = true
    } finally {
      await handle?.close()
    }
  }
  return {
    mcp: [...mcp.values()].slice(0, 100),
    notices: failed ? ['部分 MCP 配置无法读取或格式不支持，请在原生程序核对。'] : []
  }
}
