import { execFile, spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { readFile, realpath, stat } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { basename, delimiter, dirname, isAbsolute, join, resolve } from 'node:path'
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

/**
 * 读取指定会话的 Desktop 标题/空白标记。
 * 使用 `session_projcache/sessions/<id>.json` 单会话缓存；总索引会被 Desktop 按当前工作区截断。
 */
export async function dshSessionMetadata(ids: string[]): Promise<Map<string, DshSessionMeta>> {
  const result = new Map<string, DshSessionMeta>()
  const home = process.env.DSH_HOME ? resolve(process.env.DSH_HOME) : join(homedir(), '.dsh')
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
