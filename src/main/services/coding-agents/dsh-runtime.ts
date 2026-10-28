import { execFile, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { copyFile, readFile, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { basename, delimiter, dirname, isAbsolute, join, normalize, resolve } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'
import type { CodingAgentWorkspaceResult } from '../../../shared/coding-agents'
import { CodingAgentError } from './adapter'
import { StdioRpcConnection } from './stdio-rpc-connection'

/** 原生 exe 或已验证包的固定 Node 入口；从不执行任意 shell 命令。 */
export interface DshLaunchSpec {
  path: string
  command: string
  args: string[]
  electronNode: boolean
  version: string
}

/**
 * DSH 宿主只把启动 cwd 用于 .env 等启动层；项目路径由 ACP session cwd 传入。
 * 固定使用独立空目录，避免项目 .env 中的 DEEPSEEK_BASE_URL、代理等启动变量
 * 让宿主退出，同时保留项目自身继续使用该 .env。
 */
export function dshLaunchDirectory(): string {
  const directory = join(tmpdir(), 'tool-box-dsh-launch')
  try {
    mkdirSync(directory, { recursive: true })
  } catch {
    throw new CodingAgentError('无法创建 DSH 启动目录，请检查临时目录权限')
  }
  return directory
}

export interface DshSessionMeta {
  title: string
  blank: boolean
  lastPromptAt: number | null
}

/** 解析 DSH Desktop 的单会话缓存记录；只取标题和空白标记，不读消息正文。 */
export function parseDshSessionRecord(value: unknown): DshSessionMeta | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  const record = (value as Record<string, unknown>).record
  if (record === null || typeof record !== 'object' || Array.isArray(record)) return null
  const rows = (record as Record<string, unknown>).rows
  if (rows === null || typeof rows !== 'object' || Array.isArray(rows)) return null
  const titleRow = (rows as Record<string, unknown>).title
  const metaRow = (rows as Record<string, unknown>).sessionListMetadata
  const titleValue =
    titleRow !== null && typeof titleRow === 'object' && !Array.isArray(titleRow)
      ? (titleRow as Record<string, unknown>).val
      : undefined
  const metaValue =
    metaRow !== null && typeof metaRow === 'object' && !Array.isArray(metaRow)
      ? (metaRow as Record<string, unknown>).val
      : undefined
  const title = typeof titleValue === 'string' ? titleValue.trim().slice(0, 100) : ''
  const blank =
    metaValue !== null &&
    typeof metaValue === 'object' &&
    !Array.isArray(metaValue) &&
    (metaValue as Record<string, unknown>).blank === true
  const lastPromptAt =
    metaValue !== null &&
    typeof metaValue === 'object' &&
    !Array.isArray(metaValue) &&
    typeof (metaValue as Record<string, unknown>).lastPromptAt === 'number'
      ? ((metaValue as Record<string, unknown>).lastPromptAt as number)
      : null
  return { title, blank, lastPromptAt }
}

/** DSH 配置根目录；默认 ~/.dsh，可被 DSH_HOME 覆盖。 */
function dshHome(): string {
  return process.env.DSH_HOME ? resolve(process.env.DSH_HOME) : join(homedir(), '.dsh')
}

/**
 * 读取指定会话的 Desktop 标题/空白标记。
 * 使用 `session_projcache/sessions/<id>.json` 单会话缓存；总索引会被 Desktop 按当前工作区截断。
 */
export async function dshSessionMetadata(ids: string[]): Promise<Map<string, DshSessionMeta>> {
  const result = new Map<string, DshSessionMeta>()
  const home = dshHome()
  const directory = join(home, 'storages/session_projcache/sessions')
  const unique = [...new Set(ids)]
    .filter((id) => /^[A-Za-z0-9._-]{1,200}$/.test(id))
    .slice(0, 500)
  for (const id of unique) {
    try {
      const content = await readFile(join(directory, `${id}.json`), 'utf8')
      if (content.length > 1_000_000) continue
      const meta = parseDshSessionRecord(JSON.parse(content))
      if (meta) result.set(id, meta)
    } catch {
      // 单会话缓存可能尚未写入或正在更新；保留 ACP 结果并回退到通用标题。
    }
  }
  return result
}

export interface DshHistoryMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
}

interface ZstdFrame {
  start: number
  end: number
}

const ZSTD_MAGIC = 0xfd2fb528

/**
 * 扫描 DSH `session.v4.jsonl.zstd` 的连续 Zstandard frame。
 * Node 的一次性解码只读第一帧；这里按 frame 边界拆分，再逐帧解码。
 */
function scanZstdFrames(buffer: Buffer): ZstdFrame[] {
  const frames: ZstdFrame[] = []
  let offset = 0
  while (offset < buffer.length) {
    const start = offset
    if (buffer.length - offset < 4 || buffer.readUInt32LE(offset) !== ZSTD_MAGIC) break
    offset += 4
    if (offset === buffer.length) break
    const descriptor = buffer.readUInt8(offset)
    offset += 1
    if ((descriptor & 24) !== 0) break
    const contentSizeFlag = descriptor >>> 6
    const singleSegment = (descriptor & 32) !== 0
    const checksum = (descriptor & 4) !== 0
    const dictionaryFlag = descriptor & 3
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag
    const contentSizeBytes =
      contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : ([0, 2, 4, 8][contentSizeFlag] ?? 0)
    offset += (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes
    if (offset > buffer.length) break
    let last = false
    while (!last) {
      if (buffer.length - offset < 3) return frames
      const blockHeader = buffer.readUIntLE(offset, 3)
      offset += 3
      last = (blockHeader & 1) !== 0
      const blockType = (blockHeader >>> 1) & 3
      const blockSize = blockHeader >>> 3
      if (blockType === 3) return frames
      const payloadBytes = blockType === 1 ? 1 : blockSize
      if (buffer.length - offset < payloadBytes) return frames
      offset += payloadBytes
    }
    if (checksum) {
      if (buffer.length - offset < 4) break
      offset += 4
    }
    frames.push({ start, end: offset })
  }
  return frames
}

/** 解码完整的 session frame；文件末尾的未完成 frame 直接忽略。 */
function decodeDshSession(buffer: Buffer): string {
  const chunks: Buffer[] = []
  let total = 0
  for (const frame of scanZstdFrames(buffer)) {
    try {
      const output = zstdDecompressSync(buffer.subarray(frame.start, frame.end))
      total += output.length
      if (total > 64_000_000) break
      chunks.push(output)
    } catch {
      break
    }
  }
  return Buffer.concat(chunks).toString('utf8')
}

function eventObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

/** 只拼接文本 part；reasoning、图片和工具块不进入消息正文。 */
function contentText(value: unknown): string {
  if (typeof value === 'string') return value
  if (!Array.isArray(value)) return ''
  const parts: string[] = []
  for (const raw of value) {
    const part = eventObject(raw)
    if (part?.type === 'text' && typeof part.text === 'string') parts.push(part.text)
  }
  return parts.join('')
}

/** 解析 DSH session 事件，只保留真实用户消息和助教文本消息。 */
export function parseDshSessionEvents(text: string): DshHistoryMessage[] {
  const messages: DshHistoryMessage[] = []
  const ids = new Set<string>()
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue
    let value: unknown
    try {
      value = JSON.parse(line)
    } catch {
      continue
    }
    const event = eventObject(value)
    if (!event) continue
    const data = eventObject(event.data)
    const seq = typeof event.seq === 'number' ? event.seq : messages.length + 1
    if (event.type === 'user/message') {
      const source = eventObject(data?.source)
      if (source && source.kind !== 'user') continue
      const content = contentText(data?.content)
      if (!content.trim()) continue
      const id = typeof data?.id === 'string' ? data.id : `user-${seq}`
      if (ids.has(id)) continue
      ids.add(id)
      messages.push({ id, role: 'user', content })
    } else if (event.type === 'assistant/message') {
      const message = eventObject(data?.message)
      const content = contentText(message?.content)
      if (!content.trim()) continue
      const id = typeof message?.id === 'string' ? message.id : `assistant-${seq}`
      if (ids.has(id)) continue
      ids.add(id)
      messages.push({ id, role: 'assistant', content })
    }
  }
  const result: DshHistoryMessage[] = []
  let chars = 0
  for (let index = messages.length - 1; index >= 0; index--) {
    const content = messages[index].content.slice(0, 50_000)
    if (result.length >= 200 || chars + content.length > 200_000) break
    result.unshift({ ...messages[index], content })
    chars += content.length
  }
  return result
}

async function findDshSessionFile(id: string): Promise<string | null> {
  if (!/^[A-Za-z0-9._-]{1,200}$/.test(id)) return null
  const root = join(dshHome(), 'sessions')
  let projects
  try {
    projects = await readdir(root, { withFileTypes: true })
  } catch {
    return null
  }
  for (const project of projects.slice(0, 200)) {
    if (!project.isDirectory()) continue
    const file = join(root, project.name, id, 'session.v4.jsonl.zstd')
    try {
      if ((await stat(file)).isFile()) return file
    } catch {
      // 继续检查其他项目目录。
    }
  }
  return null
}

/** 读取一个 DSH 会话的历史正文；格式不匹配或读取失败时返回空数组。 */
export async function dshSessionMessages(id: string): Promise<DshHistoryMessage[]> {
  const file = await findDshSessionFile(id)
  if (!file) return []
  try {
    const buffer = await readFile(file)
    if (buffer.length > 16_000_000) return []
    return parseDshSessionEvents(decodeDshSession(buffer))
  } catch {
    return []
  }
}

function canonicalDshPath(value: string): string {
  const normalized = normalize(resolve(value)).replace(/[\\/]+$/, '')
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

/**
 * 把已存在的 DSH 会话归入匹配的项目工作区。
 * DSH 的工作区归属保存在 `storages/workspace.json`，不是 ACP 字段；只在用户明确操作时写入，
 * 版本/路径不匹配或文件不可写时拒绝，不自动创建或删除工作区。
 */
export async function attachDshWorkspace(
  sessionId: string,
  directory: string
): Promise<CodingAgentWorkspaceResult> {
  if (!/^[A-Za-z0-9._-]{1,200}$/.test(sessionId))
    throw new CodingAgentError('DSH 会话标识无效，未写入工作区')
  const file = join(dshHome(), 'storages', 'workspace.json')
  let content: string
  try {
    content = await readFile(file, 'utf8')
  } catch {
    throw new CodingAgentError('DSH 工作区数据不存在，请先在 DSH Desktop 创建项目工作区')
  }
  let value: unknown
  try {
    value = JSON.parse(content)
  } catch {
    throw new CodingAgentError('DSH 工作区数据无法读取，未写入')
  }
  const root = eventObject(value)
  const unit = eventObject(root?.unit)
  const tables = eventObject(root?.tables)
  const workspaces = eventObject(tables?.workspaces)
  if (unit?.name !== 'workspace' || unit.version !== 2 || !workspaces)
    throw new CodingAgentError('DSH 工作区数据版本不支持，未写入')
  const targetPath = canonicalDshPath(directory)
  let target: Record<string, unknown> | null = null
  for (const raw of Object.values(workspaces)) {
    const workspace = eventObject(raw)
    if (workspace && typeof workspace.path === 'string' && canonicalDshPath(workspace.path) === targetPath) {
      target = workspace
      break
    }
  }
  if (!target)
    throw new CodingAgentError('DSH 中没有与当前项目匹配的工作区，请先在 DSH Desktop 创建')
  const title =
    typeof target.title === 'string' && target.title.trim()
      ? target.title.trim()
      : basename(directory)
  const sessionIds = Array.isArray(target.sessionIds)
    ? target.sessionIds.filter((id): id is string => typeof id === 'string')
    : []
  const global = eventObject(root?.global)
  const archived = global && Array.isArray(global.archivedSessionIds) ? global.archivedSessionIds : []
  const wasArchived = archived.includes(sessionId)
  if (sessionIds.includes(sessionId) && !wasArchived)
    return { workspace: title, message: `该会话已在 DSH 工作区「${title}」中。` }

  target.sessionIds = [sessionId, ...sessionIds.filter((id) => id !== sessionId)]
  target.updatedAt = new Date().toISOString()
  if (global && Array.isArray(global.archivedSessionIds))
    global.archivedSessionIds = global.archivedSessionIds.filter((id) => id !== sessionId)
  const backup = `${file}.toolbox-backup`
  try {
    await copyFile(file, backup)
  } catch {
    throw new CodingAgentError('无法备份 DSH 工作区数据，未写入；请先关闭 DSH Desktop 后重试')
  }
  const temporary = `${file}.toolbox-${randomUUID()}.tmp`
  try {
    await writeFile(temporary, `${JSON.stringify(root, null, 2)}\n`, 'utf8')
    await rename(temporary, file)
  } catch {
    await rm(temporary, { force: true }).catch(() => undefined)
    throw new CodingAgentError('无法写入 DSH 工作区数据；请先关闭 DSH Desktop 后重试')
  }
  return {
    workspace: title,
    message: `已归入 DSH 工作区「${title}」；重启或刷新 DSH Desktop 后可见。`
  }
}

function commandOutput(command: string, args: string[], env = process.env): Promise<string> {
  return new Promise((resolve, reject) =>
    execFile(
      command,
      args,
      { env, windowsHide: true, timeout: 10_000, maxBuffer: 32_768 },
      (error, stdout) =>
        error ? reject(new CodingAgentError('无法验证 DSH 程序，请检查官方安装')) : resolve(stdout)
    )
  )
}

/** 仅查询卸载项中的安装位置，不读取原生认证或运行设置。 */
async function desktopInstallations(): Promise<string[]> {
  if (process.platform !== 'win32') return []
  try {
    const root = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall'
    const output = await commandOutput('reg.exe', [
      'query',
      root,
      '/s',
      '/f',
      'DeepSeek Harness',
      '/d'
    ])
    const keys = output
      .split(/\r?\n/)
      .map((value) => value.trim())
      .filter((value) =>
        /^HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\[^\\\r\n]{1,200}$/.test(
          value
        )
      )
      .slice(0, 10)
    const locations: string[] = []
    for (const key of keys) {
      const item = await commandOutput('reg.exe', ['query', key, '/v', 'InstallLocation'])
      const directory = /^\s*InstallLocation\s+REG_SZ\s+(.+)$/m.exec(item)?.[1].trim()
      if (directory && isAbsolute(directory))
        locations.push(join(directory, 'DeepSeek Harness.exe'))
    }
    return locations
  } catch {
    // 未安装 Desktop 或没有对应注册项，继续检查 PATH 和用户选择的程序。
    return []
  }
}

export async function inspectDshExecutable(path: string): Promise<DshLaunchSpec> {
  if (!isAbsolute(path)) throw new CodingAgentError('请选择 DSH 程序的绝对路径')
  const file = await realpath(path).catch(() => '')
  if (!file || !(await stat(file)).isFile()) throw new CodingAgentError('DSH 程序不存在')
  let command = file
  let args: string[] = []
  let electronNode = false
  if (/^DeepSeek Harness\.exe$/i.test(basename(file))) {
    const entry = join(
      dirname(file),
      'resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js'
    )
    args = ['--expose-internals', entry]
    electronNode = true
  } else if (/^dsh\.cmd$/i.test(basename(file))) {
    // Desktop 公共 shim 只用于定位固定 exe/入口；绝不把 shim 内容作为命令执行。
    if (basename(dirname(file)) === 'bin' && basename(dirname(dirname(file))) === 'cli') {
      return inspectDshExecutable(resolve(dirname(file), '../../../../DeepSeek Harness.exe'))
    }
    const packageRoot = join(dirname(file), 'node_modules/@deepseek-ai/dsh')
    const manifest = JSON.parse(
      await readFile(join(packageRoot, 'package.json'), 'utf8')
    ) as Record<string, unknown>
    if (
      manifest.name !== '@deepseek-ai/dsh' ||
      (manifest.bin as Record<string, unknown> | undefined)?.dsh !== 'lib/bin.js'
    )
      throw new CodingAgentError('请选择官方 DSH npm shim 或 Desktop 程序')
    command = process.execPath
    args = [join(packageRoot, 'lib/bin.js')]
    electronNode = Boolean(process.versions.electron)
  } else if (!/^dsh(?:\.exe)?$/i.test(basename(file)))
    throw new CodingAgentError('请选择官方 DSH CLI 或 DeepSeek Harness Desktop 程序')
  const env = { ...process.env }
  if (electronNode) env.ELECTRON_RUN_AS_NODE = '1'
  else delete env.ELECTRON_RUN_AS_NODE
  const output = await commandOutput(command, [...args, '--version'], env)
  const version = /(?:^|\s)(\d+\.\d+\.\d+(?:[-+][\w.-]+)?)(?:\s|$)/.exec(output.trim())?.[1]
  if (!version || output.length > 4096)
    throw new CodingAgentError('DSH 未返回有效版本，请选择官方程序')
  return { path: file, command, args, electronNode, version }
}

export async function detectDshExecutable(preferred?: string): Promise<string | null> {
  const names = process.platform === 'win32' ? ['dsh.exe', 'dsh.cmd'] : ['dsh']
  const candidates = [
    preferred,
    ...(process.env.PATH ?? '')
      .split(delimiter)
      .filter(isAbsolute)
      .flatMap((dir) => names.map((name) => join(dir, name))),
    ...(await desktopInstallations()),
    join(homedir(), '.local/bin/dsh')
  ]
  for (const path of candidates) {
    if (!path) continue
    try {
      if ((await stat(path)).isFile()) return path
    } catch {
      /* 不存在的安装位置继续检测。 */
    }
  }
  return null
}

/** 用独立启动目录运行宿主；项目目录由 ACP 会话参数传入，避免读取项目 .env。 */
export function launchDsh(
  spec: DshLaunchSpec,
  launchDirectory: string,
  notification: (method: string, params: unknown) => void,
  request: (method: string, params: unknown) => Promise<unknown>,
  disconnected: () => void
): StdioRpcConnection {
  const env = { ...process.env }
  if (spec.electronNode) env.ELECTRON_RUN_AS_NODE = '1'
  else delete env.ELECTRON_RUN_AS_NODE
  for (const key of Object.keys(env))
    if (/^(OPENAI|ANTHROPIC|OPENCODE|KIMI|MOONSHOT)_/i.test(key) && /KEY|TOKEN|SECRET/i.test(key))
      delete env[key]
  return new StdioRpcConnection(
    spawn(spec.command, [...spec.args, '--profile', 'acp'], {
      cwd: launchDirectory,
      env,
      windowsHide: true,
      shell: false,
      stdio: 'pipe'
    }),
    notification,
    request,
    disconnected,
    'DSH',
    (message) => new CodingAgentError(message),
    5000
  )
}
