import { open, readdir, realpath, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, isAbsolute, join, relative, sep } from 'node:path'
import type { CodingAgentId } from '../../../shared/coding-agents'
import { CodingAgentError } from './adapter'

/** 仅索引固定 Skill 根目录；正文由用户选定后的原生 Agent 按权限读取。 */
export interface LocalSkill {
  name: string
  description: string
  path: string
}
const FOLDERS: Record<CodingAgentId, string> = {
  codex: '.codex',
  opencode: '.opencode',
  claude: '.claude',
  'claude-desktop': '.claude',
  dsh: '.dsh',
  kimi: '.kimi'
}
const MAX_HEADER = 16 * 1024
const MAX_SKILL_BYTES = 256 * 1024
const within = (root: string, path: string): boolean => {
  const part = relative(root, path)
  return Boolean(part) && part !== '..' && !part.startsWith(`..${sep}`) && !isAbsolute(part)
}

/** 支持常见标量与折叠／字面量说明；不执行 YAML 标签或读取整个技能正文。 */
function skillHeader(text: string): { name: string; description: string } | null {
  const front = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text)
  if (!front) return null
  const lines = front[1].split(/\r?\n/)
  if (lines.some((line) => /^user-invocable:\s*false\s*(?:#.*)?$/.test(line))) return null
  const scalar = (key: string): string => {
    const index = lines.findIndex((line) => line.startsWith(`${key}:`))
    if (index < 0) return ''
    const raw = lines[index].slice(key.length + 1).trim()
    if (/^[>|][-+]?\s*$/.test(raw)) {
      const parts: string[] = []
      for (let i = index + 1; i < lines.length && /^(?:\s|$)/.test(lines[i]); i++)
        parts.push(lines[i].trim())
      return parts.join(' ').trim()
    }
    if (raw.startsWith('"') && raw.endsWith('"')) {
      try {
        const value: unknown = JSON.parse(raw)
        return typeof value === 'string' ? value : ''
      } catch {
        return ''
      } // 不能可靠解析的引号值不猜测。
    }
    if (raw.startsWith("'") && raw.endsWith("'")) return raw.slice(1, -1).replaceAll("''", "'")
    return raw.replace(/\s+#.*$/, '').trim()
  }
  const name = scalar('name'),
    description = scalar('description')
  return /^[a-z0-9][a-z0-9-]{0,63}$/.test(name) && description
    ? { name, description: description.slice(0, 450) }
    : null
}

/** 项目目录必须真实可用；目录顺序决定同名技能的优先级。 */
export async function discoverLocalSkills(
  id: CodingAgentId,
  directory: string,
  home = homedir(),
  env: NodeJS.ProcessEnv = process.env
): Promise<{ skills: LocalSkill[]; notices: string[] }> {
  const project = await realpath(directory).catch(() => '')
  if (!project) return { skills: [], notices: [] }
  const nativeHome =
    id === 'codex' ? env.CODEX_HOME : id === 'claude' ? env.CLAUDE_CONFIG_DIR : undefined
  const roots = [
    join(project, FOLDERS[id], 'skills'),
    join(project, '.agents', 'skills'),
    id === 'opencode'
      ? join(env.XDG_CONFIG_HOME || join(home, '.config'), 'opencode', 'skills')
      : join(nativeHome || join(home, FOLDERS[id]), 'skills'),
    join(home, '.agents', 'skills'),
    join(home, '.cc-switch', 'skills')
  ]
  const actualRoots = [
    ...new Set(
      (await Promise.all(roots.map((root) => realpath(root).catch(() => '')))).filter(Boolean)
    )
  ]
  const skills = new Map<string, LocalSkill>()
  let skipped = 0,
    visited = 0
  for (const root of actualRoots) {
    let entries
    try {
      entries = await readdir(root, { withFileTypes: true })
    } catch {
      skipped++
      continue
    } // 权限或损坏目录不阻塞其他 Skill 根。
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith('.')) continue
      if (++visited > 600 || skills.size >= 300) break
      const candidate = join(root, entry.name, 'SKILL.md')
      let handle: Awaited<ReturnType<typeof open>> | undefined
      try {
        const actual = await realpath(candidate)
        if (
          basename(actual) !== 'SKILL.md' ||
          !actualRoots.some((allowed) => within(allowed, actual))
        ) {
          skipped++
          continue
        }
        handle = await open(actual, 'r')
        const info = await handle.stat()
        if (!info.isFile() || info.size > MAX_SKILL_BYTES) {
          skipped++
          continue
        }
        const buffer = Buffer.alloc(MAX_HEADER)
        const { bytesRead } = await handle.read(buffer, 0, MAX_HEADER, 0)
        const metadata = skillHeader(buffer.subarray(0, bytesRead).toString('utf8'))
        if (metadata && !skills.has(metadata.name))
          skills.set(metadata.name, {
            ...metadata,
            path: actual,
            description: `本机文件引用 · ${metadata.description}`
          })
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') skipped++
      } finally {
        await handle?.close()
      }
    }
  }
  return {
    skills: [...skills.values()],
    notices: [
      ...(skipped ? ['部分本机 Skill 路径不可访问、越界或超过读取上限，未列出。'] : []),
      ...(visited > 600 || skills.size >= 300
        ? ['本机 Skill 达到发现上限，请减少技能目录条目。']
        : [])
    ]
  }
}

/** 选择后再次核对规范路径，拒绝删除、改名或换成链接的 Skill；不读取正文。 */
export async function resolveLocalSkill(path: string): Promise<string> {
  const actual = await realpath(path).catch(() => '')
  const info = actual ? await stat(actual).catch(() => null) : null
  if (
    !actual ||
    actual !== path ||
    basename(actual) !== 'SKILL.md' ||
    !info?.isFile() ||
    info.size > MAX_SKILL_BYTES
  )
    throw new CodingAgentError('本机 Skill 已失效或发生路径变化，请刷新并重新选择；草稿已保留')
  return actual
}
