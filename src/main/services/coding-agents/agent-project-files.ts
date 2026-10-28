import { randomUUID } from 'node:crypto'
import { lstat, opendir, realpath } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import type { AgentFileSearchResult, AgentReference } from '../../../shared/agent-actions'
import { CodingAgentError } from './adapter'

const EXCLUDED = new Set([
  '.git',
  'node_modules',
  'out',
  'dist',
  'release',
  'build',
  'coverage',
  '.idea',
  '.next',
  '.nuxt',
  '.venv',
  'vendor',
  '.ssh',
  '.aws',
  '.azure'
])

/** 名称级防护并非磁盘授权；最终还须检查真实落点和原生读取权限。 */
export function isProjectFile(path: string): boolean {
  if (/(?:^|[\\/])\.claude[\\/]settings(?:\.local)?\.json$/i.test(path)) return false
  return !path
    .split(/[\\/]/)
    .some(
      (part) =>
        EXCLUDED.has(part.toLowerCase()) ||
        /^(?:\.env(?:\..*)?|\.mcp\.json|\.npmrc|\.pypirc|\.netrc|auth\.json|credentials(?:\..*)?|secrets?(?:\..*)?|password-master-key\.json|ai-settings\.json|toolbox\.db(?:-.*)?|id_(?:rsa|ed25519)(?:\..*)?)$/i.test(
          part
        ) ||
        /\.(?:pem|key|pfx|p12|keystore)$/i.test(part)
    )
}

/** Windows 路径大小写由文件系统处理；relative 防止同名前缀目录绕过根约束。 */
export function withinProject(root: string, path: string): boolean {
  const child = relative(root, path)
  return Boolean(child) && child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child)
}

/** 引用绑定窗口、运行时和真实项目；有数量上限，不持久化正文。 */
export class AgentProjectFiles {
  private readonly references = new Map<string, { scope: string; root: string; path: string }>()

  async search(scope: string, directory: string, query: string): Promise<AgentFileSearchResult> {
    const root = await realpath(directory).catch(() => '')
    if (!root || !isAbsolute(root)) throw new CodingAgentError('项目目录已不可访问')
    const needle = query.replaceAll('\\', '/').toLowerCase()
    const directories = [root]
    const matches: string[] = []
    let visited = 0
    let limited = false
    const deadline = Date.now() + 350
    for (let index = 0; index < directories.length; index++) {
      if (index >= 600 || Date.now() > deadline || visited > 12_000) {
        limited = true
        break
      }
      const actual = await realpath(directories[index]).catch(() => '')
      if (!actual || (actual !== root && !withinProject(root, actual))) continue
      const entries = await opendir(actual).catch(() => null)
      if (!entries) continue
      for await (const entry of entries) {
        if (++visited > 12_000 || Date.now() > deadline) {
          limited = true
          break
        }
        const path = resolve(actual, entry.name)
        const name = relative(root, path).replaceAll('\\', '/')
        if (!isProjectFile(name) || entry.isSymbolicLink()) continue
        if (entry.isDirectory() && name.split('/').length < 15) directories.push(path)
        else if (entry.isFile() && name.toLowerCase().includes(needle)) matches.push(path)
      }
    }
    matches.sort((a, b) => {
      const score = (path: string): number =>
        path
          .slice(path.lastIndexOf(sep) + 1)
          .toLowerCase()
          .startsWith(needle)
          ? 0
          : 1
      return score(a) - score(b) || a.localeCompare(b)
    })
    const files: AgentReference[] = matches.slice(0, 50).map((path) => {
      // 同一搜索候选复用引用，避免快速键入挤掉用户已经选中的条目。
      const existing = [...this.references].find(
        ([, item]) => item.scope === scope && item.root === root && item.path === path
      )
      const id = existing?.[0] ?? randomUUID()
      this.references.set(id, { scope, root, path })
      return { id, kind: 'file', label: relative(root, path).replaceAll('\\', '/') }
    })
    while (this.references.size > 2000) this.references.delete(this.references.keys().next().value!)
    return { files, limited: limited || matches.length > 50 }
  }

  async resolve(scope: string, directory: string, reference: AgentReference): Promise<string> {
    const item = this.references.get(reference.id)
    const root = await realpath(directory).catch(() => '')
    if (!item || item.scope !== scope || item.root !== root)
      throw new CodingAgentError('文件引用已失效，请重新选择；草稿已保留')
    const target = await realpath(item.path).catch(() => '')
    const info = target ? await lstat(target).catch(() => null) : null
    if (
      !target ||
      !withinProject(root, target) ||
      !info?.isFile() ||
      !isProjectFile(relative(root, target)) ||
      info.size > 2 * 1024 * 1024
    )
      throw new CodingAgentError('引用文件已失效、越出项目或超过 2 MB，请重新选择')
    return target
  }

  release(scopePrefix: string): void {
    for (const [id, item] of this.references)
      if (item.scope.startsWith(scopePrefix)) this.references.delete(id)
  }
}
