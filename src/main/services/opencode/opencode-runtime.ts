import { OpenCodeError } from './opencode-error'
import { execFile, spawn } from 'node:child_process'
import { access, realpath, stat } from 'node:fs/promises'
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

export async function detectOpenCodeExecutable(preferred?: string): Promise<string | null> {
  const candidates = [
    preferred,
    process.env.LOCALAPPDATA &&
      join(
        process.env.LOCALAPPDATA,
        'Programs',
        '@opencodedesktop',
        'resources',
        'opencode-cli.exe'
      ),
    process.env.LOCALAPPDATA &&
      join(process.env.LOCALAPPDATA, 'Programs', 'OpenCode', 'resources', 'opencode-cli.exe'),
    process.platform === 'darwin'
      ? '/Applications/OpenCode.app/Contents/Resources/opencode-cli'
      : undefined
  ]
  for (const candidate of candidates) {
    if (!candidate) continue
    try {
      await access(candidate)
      return candidate
    } catch {
      /* 不存在的标准安装位置继续尝试；自定义安装位置由用户选择。 */
    }
  }
  return null
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
