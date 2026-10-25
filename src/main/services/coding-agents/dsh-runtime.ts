import { execFile, spawn } from 'node:child_process'
import { readFile, realpath, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
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

export function launchDsh(
  spec: DshLaunchSpec,
  directory: string,
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
      cwd: directory,
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
