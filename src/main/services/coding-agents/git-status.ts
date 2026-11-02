/**
 * 读取项目目录的 Git 状态，供编程工作台显示当前分支与改动规模。
 *
 * 只用本机 `git` 命令，不引入依赖、不执行写操作；命令带超时并禁用 shell，
 * 目录只能来自已连接或用户明确选择的项目。结果按目录短期缓存，避免频繁刷新时反复起进程。
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import type { GitStatusView } from '../../../shared/coding-agents'

const run = promisify(execFile)
const CACHE_MS = 3_000
const COMMAND_TIMEOUT_MS = 4_000
const MAX_OUTPUT = 2 * 1024 * 1024

const cache = new Map<string, { at: number; value: GitStatusView | null }>()

/** 输出超过上限时截断，只用于统计行数，不需要完整 diff 内容。 */
function trimOutput(value: string): string {
  return value.length > MAX_OUTPUT ? value.slice(0, MAX_OUTPUT) : value
}

/**
 * 解析 `git status --porcelain=v1 -b` 的首行与改动条数。
 *
 * 支持：`## main`、`## main...origin/main [ahead 1, behind 2]`、
 * `## No commits yet on main`、`## HEAD (no branch)`。
 */
export function parseStatusOutput(stdout: string): Omit<GitStatusView, 'directory'> | null {
  const lines = stdout.split('\n')
  const header = (lines[0] ?? '').replace(/\r$/, '')
  if (!header.startsWith('## ')) return null
  const body = header.slice(3)
  let branch: string
  let detached = false
  let ahead = 0
  let behind = 0
  if (body.startsWith('HEAD (no branch)')) {
    detached = true
    branch = ''
  } else if (body.startsWith('No commits yet on ')) {
    branch = body.slice('No commits yet on '.length)
  } else {
    const [name, tracking] = body.split(' [')
    branch = name.split('...')[0]
    const aheadMatch = /ahead (\d+)/.exec(tracking ?? '')
    const behindMatch = /behind (\d+)/.exec(tracking ?? '')
    ahead = aheadMatch ? Number(aheadMatch[1]) : 0
    behind = behindMatch ? Number(behindMatch[1]) : 0
  }
  const changedFiles = lines
    .slice(1)
    .filter((line) => line.trim().length > 0)
    .length
  return { branch, detached, ahead, behind, changedFiles, insertions: 0, deletions: 0 }
}

/** `git diff --numstat` 汇总；二进制文件以 `-` 记 0，不会污染总数。 */
export function parseNumstat(stdout: string): { insertions: number; deletions: number } {
  let insertions = 0
  let deletions = 0
  for (const line of trimOutput(stdout).split('\n')) {
    if (!line.trim()) continue
    const [added, removed] = line.split('\t')
    const plus = Number(added)
    const minus = Number(removed)
    if (Number.isFinite(plus)) insertions += plus
    if (Number.isFinite(minus)) deletions += minus
  }
  return { insertions, deletions }
}

async function git(directory: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await run('git', ['-C', directory, ...args], {
      timeout: COMMAND_TIMEOUT_MS,
      windowsHide: true,
      maxBuffer: MAX_OUTPUT,
      encoding: 'utf8'
    })
    return stdout
  } catch {
    // 不是 Git 仓库、未安装 git 或超时都视为"没有可显示的分支信息"。
    return null
  }
}

/** 读取分支、跟踪差距与改动规模；非 Git 仓库返回 null。 */
export async function readGitStatus(directory: string): Promise<GitStatusView | null> {
  if (!directory) return null
  const key = process.platform === 'win32' ? directory.toLowerCase() : directory
  const cached = cache.get(key)
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value

  const status = await git(directory, ['status', '--porcelain=v1', '--branch'])
  const parsed = status === null ? null : parseStatusOutput(status)
  let value: GitStatusView | null = null
  if (parsed) {
    const diff = parsed.changedFiles
      ? await git(directory, ['diff', '--numstat', 'HEAD'])
      : null
    const numstat = diff ? parseNumstat(diff) : { insertions: 0, deletions: 0 }
    value = { ...parsed, ...numstat, directory }
  }
  if (cache.size > 50) cache.clear()
  cache.set(key, { at: Date.now(), value })
  return value
}
