import { execFile } from 'node:child_process'
import type { Dirent } from 'node:fs'
import { lstat, readFile, readdir } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { normalizeDraftDirectory } from '../../../shared/agent-drafts'
import { CodingAgentError } from './adapter'
import { claudeDesktopDataDirectory } from './claude-desktop-settings'

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i
const MAX_METADATA_BYTES = 512 * 1024
const object = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null

/** 原生桌面 ID 与 CLI ID 不同；只把 CLI ID 交给 SDK，不透传其他桌面元数据。 */
export interface DesktopCodeSession {
  id: string
  title: string
  directory: string
  resumable: boolean
}

function session(value: unknown, directory: string): DesktopCodeSession | null {
  const row = object(value)
  if (
    !row ||
    typeof row.cliSessionId !== 'string' ||
    !UUID.test(row.cliSessionId) ||
    typeof row.cwd !== 'string' ||
    row.cwd.length > 4096 ||
    row.cwd.includes('\0') ||
    !isAbsolute(row.cwd) ||
    normalizeDraftDirectory(row.cwd) !== normalizeDraftDirectory(directory) ||
    (row.mode !== undefined && row.mode !== null && row.mode !== 'local')
  )
    return null
  const title = typeof row.title === 'string' ? row.title.replace(/[\r\n\t\0]/g, ' ').trim() : ''
  return {
    id: row.cliSessionId,
    directory: row.cwd,
    title: title.slice(0, 100) || 'Desktop 编程会话',
    resumable:
      row.isArchived === false &&
      typeof row.completedTurns === 'number' &&
      Number.isSafeInteger(row.completedTurns) &&
      row.completedTurns > 0 &&
      typeof row.lastTurnEdgeAt === 'number' &&
      Number.isFinite(row.lastTurnEdgeAt) &&
      typeof row.latestUserFrameAt === 'number' &&
      Number.isFinite(row.latestUserFrameAt) &&
      row.lastTurnEdgeAt >= row.latestUserFrameAt &&
      (row.interruptedAwaitingPerson === undefined || row.interruptedAwaitingPerson === null)
  }
}

/** 有界遍历会话描述，不跟随符号链接，不读取账号认证、聊天缓存或原文。 */
export async function readDesktopCodeSessions(directory: string): Promise<DesktopCodeSession[]> {
  const root = join(claudeDesktopDataDirectory(), 'claude-code-sessions')
  try {
    if (!(await lstat(root)).isDirectory()) return []
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw new CodingAgentError('无法读取 Desktop Code 历史目录，原有会话未修改', { cause: error })
  }
  const queue = [{ path: root, depth: 0 }]
  const found = new Map<string, DesktopCodeSession>()
  let directories = 0,
    files = 0
  while (queue.length) {
    const current = queue.shift()!
    if (++directories > 256) throw new CodingAgentError('Desktop Code 历史目录超过读取上限')
    let entries: Dirent[]
    try {
      entries = await readdir(current.path, { withFileTypes: true })
    } catch (error) {
      throw new CodingAgentError('无法读取 Desktop Code 历史目录，原有会话未修改', { cause: error })
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue
      const path = join(current.path, entry.name)
      if (entry.isDirectory() && current.depth < 3) {
        if (queue.length + directories >= 256)
          throw new CodingAgentError('Desktop Code 历史目录超过读取上限')
        queue.push({ path, depth: current.depth + 1 })
        continue
      }
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue
      if (++files > 5000) throw new CodingAgentError('Desktop Code 会话描述超过读取上限')
      try {
        const info = await lstat(path)
        if (!info.isFile() || info.size > MAX_METADATA_BYTES) continue
        const row = session(
          JSON.parse((await readFile(path, 'utf8')).replace(/^\uFEFF/, '')),
          directory
        )
        if (!row) continue
        const previous = found.get(row.id)
        // 重复描述只要有一份不允许续接，就不放宽到可写状态。
        found.set(
          row.id,
          previous ? { ...row, resumable: row.resumable && previous.resumable } : row
        )
      } catch (error) {
        // 更新过程中被移动／损坏的单条描述不影响其他记录，不输出路径或文件内容。
        console.warn('[ClaudeDesktopHistory] 跳过不可读会话描述', {
          kind: error instanceof SyntaxError ? 'invalid-json' : 'unreadable'
        })
      }
    }
  }
  return [...found.values()]
}

/** 首期保守互斥：只读历史不受影响，续接原桌面会话前要求外部 Claude 全部退出。 */
export async function assertDesktopCodeIdle(
  platform: NodeJS.Platform = process.platform
): Promise<void> {
  if (platform !== 'win32')
    throw new CodingAgentError('当前平台尚未验证 Desktop Code 原生会话续接，可先查看历史')
  const executable = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tasklist.exe')
  await new Promise<void>((resolve, reject) => {
    execFile(
      executable,
      ['/FO', 'CSV', '/NH'],
      { windowsHide: true, shell: false, timeout: 5000, maxBuffer: 1024 * 1024, encoding: 'utf8' },
      (error, stdout) => {
        // 列举全部进程，避免零匹配的提示依赖系统语言和 OEM 编码；只检查 CSV 结构与映像名。
        const rows = stdout.trim().split(/\r?\n/)
        if (error) {
          reject(new CodingAgentError('无法确认外部 Claude 是否已退出，本次未发送；请稍后重试'))
        } else if (rows.some((row) => /^"claude[^\r\n"]*",/i.test(row))) {
          reject(
            new CodingAgentError(
              '续接原生会话前，请完整退出 Claude Desktop 和其他 Claude 任务；草稿已保留'
            )
          )
        } else if (
          rows.every((row) => /^"[^"\r\n]+","\d+","[^"\r\n]*","\d+","[^"\r\n]*"$/.test(row))
        )
          resolve()
        else reject(new CodingAgentError('无法确认外部 Claude 的进程状态，本次未发送'))
      }
    )
  })
}
