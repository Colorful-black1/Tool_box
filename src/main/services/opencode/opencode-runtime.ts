import { OpenCodeError } from './opencode-error'
import { execFile, spawn } from 'node:child_process'
import { realpath, stat } from 'node:fs/promises'
import { basename, isAbsolute, join } from 'node:path'
import { AcpConnection } from './acp-connection'

/** 首版复用安装目录的原生程序，不运行安装器、shell 或桌面私有启动脚本。 */
export async function inspectOpenCodeExecutable(
  path: string
): Promise<{ path: string; version: string }> {
  if (!isAbsolute(path) || !/^opencode(?:-cli)?(?:\.exe)?$/i.test(basename(path)))
    throw new OpenCodeError('请选择 OpenCode 的原生 CLI 可执行文件')
  const resolved = await realpath(path).catch(() => '')
  if (!resolved || !(await stat(resolved)).isFile()) throw new OpenCodeError('OpenCode 程序不存在')
  const output = await new Promise<string>((resolve, reject) => {
    execFile(
      resolved,
      ['--version'],
      { windowsHide: true, timeout: 5000, maxBuffer: 4096 },
      (error, stdout) => {
        if (error) reject(new OpenCodeError('无法验证 OpenCode 版本，请选择桌面版内置的 CLI'))
        else resolve(stdout.trim())
      }
    )
  })
  const version = /^(?:opencode\s+v?)?(\d+\.\d+\.\d+(?:[-+][\w.-]+)?)$/i.exec(output)?.[1]
  if (!version) throw new OpenCodeError('所选程序未返回有效的 OpenCode 版本')
  return { path: resolved, version }
}

/** 同时兼容新旧 Desktop 安装目录，不扫描或执行私有启动脚本。 */
function desktopInstallations(): string[] {
  if (process.platform === 'darwin') return ['/Applications/OpenCode.app']
  const localAppData = process.env.LOCALAPPDATA
  if (process.platform !== 'win32' || !localAppData) return []
  return ['ai.opencode.desktop', '@opencodedesktop', 'OpenCode'].map((name) =>
    join(localAppData, 'Programs', name)
  )
}

/** 只返回实际文件，防止残留目录被误报为可执行程序。 */
async function firstExistingFile(candidates: Array<string | undefined>): Promise<string | null> {
  for (const candidate of candidates) {
    if (!candidate || !isAbsolute(candidate)) continue
    try {
      if ((await stat(candidate)).isFile()) return candidate
    } catch {
      /* 更新后旧路径可能已被移除，继续检测当前标准安装位置。 */
    }
  }
  return null
}

export async function detectOpenCodeExecutable(preferred?: string): Promise<string | null> {
  const candidates = [
    preferred,
    ...desktopInstallations().map((root) =>
      process.platform === 'darwin'
        ? join(root, 'Contents', 'Resources', 'opencode-cli')
        : join(root, 'resources', 'opencode-cli.exe')
    )
  ]
  return firstExistingFile(candidates)
}

/** 外部 Desktop 入口与 CLI 使用同一组新旧安装位置。 */
export async function detectOpenCodeDesktop(): Promise<string | null> {
  const roots = desktopInstallations()
  if (process.platform === 'darwin') {
    const root = roots[0]
    return root && (await stat(root).catch(() => null))?.isDirectory() ? root : null
  }
  return firstExistingFile(roots.map((root) => join(root, 'OpenCode.exe')))
}

/** 固定参数启动，Prompt 经 stdin JSON-RPC 传递，不拼接进命令行。 */
export function launchOpenCode(
  executable: string,
  directory: string,
  notification: (method: string, params: unknown) => void,
  request: (method: string, params: unknown) => Promise<unknown>,
  disconnected: () => void
): AcpConnection {
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  return new AcpConnection(
    spawn(executable, ['acp'], {
      cwd: directory,
      windowsHide: true,
      shell: false,
      stdio: 'pipe',
      env
    }),
    notification,
    request,
    disconnected
  )
}
