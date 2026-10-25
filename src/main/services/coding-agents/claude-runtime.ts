import { execFile } from 'node:child_process'
import { access, realpath, stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { basename, dirname, isAbsolute, join } from 'node:path'
import { CodingAgentError } from './adapter'

/** 仅定位已批准 SDK 的本平台原生组件，不读取认证配置。 */
export async function bundledClaudeExecutable(): Promise<string | null> {
  if (
    !['win32', 'darwin', 'linux'].includes(process.platform) ||
    !['x64', 'arm64'].includes(process.arch)
  )
    return null
  try {
    const require = createRequire(__filename)
    const manifest = require.resolve(
      `@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}/package.json`
    )
    const path = join(
      dirname(manifest),
      process.platform === 'win32' ? 'claude.exe' : 'claude'
    ).replace(/app\.asar([\\/])/, 'app.asar.unpacked$1')
    await access(path)
    return path
  } catch {
    // 不自动安装缺失的可选组件，界面允许用户选择已安装的 CLI。
    return null
  }
}

export async function inspectClaudeExecutable(
  path: string
): Promise<{ path: string; version: string }> {
  if (!isAbsolute(path) || !/^claude(?:\.exe)?$/i.test(basename(path)))
    throw new CodingAgentError('请选择 Claude Code 原生程序')
  const resolved = await realpath(path).catch(() => '')
  if (!resolved || !(await stat(resolved)).isFile())
    throw new CodingAgentError('Claude Code 程序不存在')
  return new Promise((resolve, reject) => {
    execFile(
      resolved,
      ['--version'],
      { windowsHide: true, timeout: 5000, maxBuffer: 4096 },
      (error, stdout) => {
        const version = /^(\d+\.\d+\.\d+(?:[-+][\w.-]+)?)\s+\(Claude Code\)\s*$/.exec(
          stdout.trim()
        )?.[1]
        if (error || !version)
          reject(new CodingAgentError('无法确认 Claude Code 版本，请选择官方原生程序'))
        else resolve({ path: resolved, version })
      }
    )
  })
}
