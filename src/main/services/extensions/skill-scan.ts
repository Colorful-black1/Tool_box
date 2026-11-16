import { createHash } from 'node:crypto'
import { open, readdir, realpath, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join, relative, sep } from 'node:path'

import type {
  ExtensionAgentId,
  ExtensionSourceStatus,
  ExtensionSourceView,
  SkillEntryView,
  SkillScanResult
} from '../../../shared/extensions'
import { skillHeader } from '../coding-agents/local-skill-catalog'

/** 单根目录与总条目的硬上限：技能目录是用户数据，不能无限膨胀。 */
const MAX_ROOT_ENTRIES = 300
const MAX_TOTAL_SKILLS = 600
const MAX_HEADER_BYTES = 16 * 1024
const MAX_SKILL_BYTES = 512 * 1024

export interface SkillRoot {
  id: string
  label: string
  dir: string
  /** 这个根被哪些 Agent 读取；自定义路径没有 Agent。 */
  agents: ExtensionAgentId[]
  /** Codex 自带的系统技能。 */
  bundled?: boolean
}

interface ResolvedRoot extends SkillRoot {
  actual: string
  display: string
}

const within = (root: string, path: string): boolean => {
  const part = relative(root, path)
  return Boolean(part) && part !== '..' && !part.startsWith(`..${sep}`) && !part.startsWith(sep)
}

/** 家目录显示为 `~`，同时保留绝对路径供用户复制。 */
export function displayPath(home: string, path: string): string {
  const part = relative(home, path)
  if (!part || part.startsWith('..') || part.startsWith(sep)) return path
  return `~/${part.split(sep).join('/')}`
}

/** 默认只统计 5 类常用来源；其余目录由用户在设置里添加。 */
export function defaultSkillRoots(home: string, env: NodeJS.ProcessEnv = process.env): SkillRoot[] {
  const config = env['XDG_CONFIG_HOME'] || join(home, '.config')
  return [
    {
      id: 'agents',
      label: '通用技能目录',
      dir: join(home, '.agents', 'skills'),
      agents: ['universal']
    },
    {
      id: 'claude',
      label: 'Claude Code 技能',
      dir: join(home, '.claude', 'skills'),
      agents: ['claude']
    },
    {
      id: 'codex',
      label: 'Codex 技能',
      dir: join(home, '.codex', 'skills'),
      agents: ['codex']
    },
    {
      id: 'codex-system',
      label: 'Codex 自带技能',
      dir: join(home, '.codex', 'skills', '.system'),
      agents: ['codex'],
      bundled: true
    },
    {
      id: 'opencode',
      label: 'OpenCode 技能',
      dir: join(config, 'opencode', 'skills'),
      agents: ['opencode']
    },
    {
      id: 'dsh',
      label: 'DeepSeek Harness 技能',
      dir: join(home, '.dsh', 'skills'),
      agents: ['dsh']
    }
  ]
}

async function resolveRoots(roots: SkillRoot[], home: string): Promise<ResolvedRoot[]> {
  const resolved = await Promise.all(
    roots.map(async (root) => {
      const actual = await realpath(root.dir).catch(() => '')
      return actual ? { ...root, actual, display: displayPath(home, actual) } : null
    })
  )
  return resolved.filter((root): root is ResolvedRoot => root !== null)
}

const SOURCE_DETAIL: Record<ExtensionSourceStatus, string> = {
  ready: '已读取',
  empty: '目录存在，但没有技能',
  missing: '未发现该目录',
  error: '目录不可读',
  partial: '部分读取'
}

function statusOf(count: number, exists: boolean, failed: boolean): ExtensionSourceStatus {
  if (!exists) return 'missing'
  if (failed) return 'error'
  return count ? 'ready' : 'empty'
}

/**
 * 扫描本机技能目录。
 *
 * 身份按 `SKILL.md` 的 realpath 计算：同一个物理目录被链接进多个 Agent 时只算一条，
 * 并把「被哪些 Agent 读取」记在 agents 上；同名但路径不同的算多条，标记冲突。
 */
export async function scanSkills(
  options: { home?: string; env?: NodeJS.ProcessEnv; extraRoots?: string[] } = {}
): Promise<SkillScanResult> {
  const home = options.home ?? homedir()
  const env = options.env ?? process.env
  const declared: SkillRoot[] = [
    ...defaultSkillRoots(home, env),
    ...(options.extraRoots ?? []).map((dir, index) => ({
      id: `custom-${index + 1}`,
      label: '自定义路径',
      dir,
      agents: []
    }))
  ]
  const roots = await resolveRoots(declared, home)

  const byPath = new Map<string, SkillEntryView>()
  const counts = new Map<string, number>()
  const failed = new Set<string>()
  const notices: string[] = []
  let unreadable = 0
  let visited = 0
  let truncated = false

  for (const root of roots) {
    let entries
    try {
      entries = await readdir(root.actual, { withFileTypes: true })
    } catch {
      failed.add(root.id)
      counts.set(root.id, 0)
      continue
    }
    let count = 0
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith('.')) continue
      if (++visited > MAX_TOTAL_SKILLS || count >= MAX_ROOT_ENTRIES) {
        truncated = true
        break
      }
      const candidate = join(root.actual, entry.name, 'SKILL.md')
      const actual = await realpath(candidate).catch(() => '')
      if (!actual || basename(actual) !== 'SKILL.md') continue
      const physical = roots.find((item) => within(item.actual, actual))
      if (!physical) continue
      let metadata: { name: string; description: string } | null
      let handle: Awaited<ReturnType<typeof open>> | undefined
      try {
        handle = await open(actual, 'r')
        const info = await handle.stat()
        if (!info.isFile() || info.size > MAX_SKILL_BYTES) continue
        const buffer = Buffer.alloc(MAX_HEADER_BYTES)
        const { bytesRead } = await handle.read(buffer, 0, MAX_HEADER_BYTES, 0)
        metadata = skillHeader(buffer.subarray(0, bytesRead).toString('utf8'))
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') unreadable++
        continue
      } finally {
        await handle?.close()
      }
      if (!metadata) continue
      count++
      const existing = byPath.get(actual)
      if (existing) {
        for (const agent of [...physical.agents, ...root.agents])
          if (!existing.agents.includes(agent)) existing.agents.push(agent)
        continue
      }
      byPath.set(actual, {
        name: metadata.name,
        description: metadata.description,
        path: actual,
        displayPath: displayPath(home, actual),
        root: physical.display,
        agents: [...new Set([...physical.agents, ...root.agents])],
        bundled: Boolean(physical.bundled || root.bundled),
        conflict: false,
        contentHash: null
      })
    }
    counts.set(root.id, (counts.get(root.id) ?? 0) + count)
  }

  // 同名不同路径：标记冲突，并给冲突组算内容摘要，避免「看起来一样其实不同」。
  const byName = new Map<string, SkillEntryView[]>()
  for (const skill of byPath.values()) {
    const list = byName.get(skill.name) ?? []
    list.push(skill)
    byName.set(skill.name, list)
  }
  for (const group of byName.values()) {
    if (group.length < 2) continue
    for (const skill of group) {
      skill.conflict = true
      skill.contentHash = await hashSkill(skill.path)
    }
  }

  const sources: ExtensionSourceView[] = declared.map((root) => {
    const resolved = roots.find((item) => item.id === root.id)
    const count = counts.get(root.id) ?? 0
    const status = statusOf(count, Boolean(resolved), failed.has(root.id))
    return {
      id: root.id,
      label: root.label,
      path: resolved?.actual ?? root.dir,
      displayPath: resolved?.display ?? displayPath(home, root.dir),
      count,
      status,
      detail: SOURCE_DETAIL[status]
    }
  })

  if (truncated) notices.push('技能数量达到发现上限，部分条目未列出。')
  if (unreadable) notices.push('部分技能目录不可读，已跳过。')

  const skills = [...byPath.values()].sort(
    (a, b) => a.name.localeCompare(b.name) || a.path.localeCompare(b.path)
  )
  return { skills, sources, scannedAt: new Date().toISOString(), notices }
}

/** 只对冲突组计算；读满上限即截断，避免大文件拖慢扫描。 */
async function hashSkill(path: string): Promise<string | null> {
  try {
    const info = await stat(path)
    if (!info.isFile() || info.size > MAX_SKILL_BYTES) return null
    const handle = await open(path, 'r')
    try {
      const buffer = Buffer.alloc(Math.min(info.size, MAX_SKILL_BYTES))
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
      return createHash('sha256').update(buffer.subarray(0, bytesRead)).digest('hex').slice(0, 12)
    } finally {
      await handle.close()
    }
  } catch {
    return null
  }
}
