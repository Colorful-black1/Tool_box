import { execFile, spawn } from 'node:child_process'
import { access, readdir, realpath, stat } from 'node:fs/promises'
import { basename, delimiter, isAbsolute, join } from 'node:path'
import { CodingAgentError } from './adapter'
import { CodexConnection } from './codex-connection'

/** 只执行明确的原生 CLI，拒绝 cmd / npm / shell 启动包装。 */
export async function inspectCodexExecutable(
  path: string
): Promise<{ path: string; version: string }> {
  if (!isAbsolute(path) || !/^codex(?:\.exe)?$/i.test(basename(path)))
    throw new CodingAgentError('请选择 Codex 原生 CLI 可执行文件')
  const resolved = await realpath(path).catch(() => '')
  if (!resolved || !(await stat(resolved)).isFile()) throw new CodingAgentError('Codex 程序不存在')
  const output = await new Promise<string>((resolve, reject) => {
    execFile(
      resolved,
      ['--version'],
      { windowsHide: true, timeout: 5000, maxBuffer: 4096 },
      (error, stdout) =>
        error ? reject(new CodingAgentError('无法验证 Codex CLI 版本')) : resolve(stdout.trim())
    )
  })
  const version = /^codex-cli\s+(\d+\.\d+\.\d+(?:[-+][\w.-]+)?)$/i.exec(output)?.[1]
  if (!version) throw new CodingAgentError('所选程序未返回有效的 Codex CLI 版本')
  return { path: resolved, version }
}

/** 检测 PATH 和 Desktop 的版本目录，不读取认证文件或修改 PATH。 */
export async function detectCodexExecutable(preferred?: string): Promise<string | null> {
  const exe = process.platform === 'win32' ? 'codex.exe' : 'codex'
  const candidates = [
    preferred,
    ...(process.env.PATH ?? '')
      .split(delimiter)
      .filter(isAbsolute)
      .map((p) => join(p, exe))
  ]
  if (process.env.LOCALAPPDATA) {
    const root = join(process.env.LOCALAPPDATA, 'OpenAI', 'Codex', 'bin')
    const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
    const versions = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory())
        .slice(0, 100)
        .map(async (entry) => ({
          path: join(root, entry.name, exe),
          time: (await stat(join(root, entry.name))).mtimeMs
        }))
    )
    candidates.push(...versions.sort((a, b) => b.time - a.time).map((entry) => entry.path))
  }
  for (const candidate of candidates) {
    if (!candidate || !isAbsolute(candidate)) continue
    try {
      await access(candidate)
      return candidate
    } catch {
      /* 不存在的位置继续检测，自定义安装由用户选择。 */
    }
  }
  return null
}

/** Prompt 只经 stdin；保持 Codex 原生 profile，不复制其他 Agent 的认证变量。 */
export function launchCodex(
  executable: string,
  directory: string,
  notification: (method: string, params: unknown) => void,
  request: (method: string, params: unknown) => Promise<unknown>,
  disconnected: () => void
): CodexConnection {
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  for (const key of Object.keys(env))
    if (/^(ANTHROPIC|OPENCODE|KIMI|MOONSHOT|DEEPSEEK)_/i.test(key) && /KEY|TOKEN|SECRET/i.test(key))
      delete env[key]
  return new CodexConnection(
    spawn(executable, ['app-server', '--stdio'], {
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
