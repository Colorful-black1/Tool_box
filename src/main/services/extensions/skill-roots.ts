import { mkdir, readFile, realpath, rename, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join } from 'node:path'

import { ExtensionError } from '../../../shared/extensions'
import type { SkillRootEntryView, SkillRootsView } from '../../../shared/extensions'
import { defaultSkillRoots, displayPath } from './skill-scan'

const MAX_ROOTS = 20
const MAX_PATH_LENGTH = 1024

interface StoredRoots {
  version: 1
  roots: string[]
}

/**
 * 规范化用户输入的扫描路径：只接受绝对路径或 `~/` 开头的路径，
 * 统一用 `/` 分隔，避免同一目录出现多种写法。
 */
export function normalizeRootPath(raw: string): string {
  const value = raw.trim()
  if (!value) throw new ExtensionError('路径不能为空')
  if (value.length > MAX_PATH_LENGTH || /[\r\n\0]/.test(value))
    throw new ExtensionError('路径过长或包含非法字符')
  if (value === '~') return '~'
  if (value.startsWith('~/') || value.startsWith('~\\')) {
    const rest = value
      .slice(2)
      .replaceAll('\\', '/')
      .replace(/^\/+/, '')
    return rest ? `~/${rest}` : '~'
  }
  if (!isAbsolute(value)) throw new ExtensionError('请填写绝对路径，或以 ~ 开头')
  return value
}

/** 把 `~` 展开成当前用户的家目录；绝对路径原样返回。 */
export function expandRootPath(home: string, path: string): string {
  if (path === '~') return home
  if (path.startsWith('~/')) return join(home, ...path.slice(2).split('/'))
  return path
}

async function isDirectory(path: string): Promise<boolean> {
  const info = await stat(path).catch(() => null)
  return Boolean(info?.isDirectory())
}

/**
 * 自定义扫描路径的持久化。
 *
 * 单独存 `userData/skill-roots.json`，不进数据库、不进备份；
 * 文件损坏时按空列表处理，不影响默认来源。
 */
export class SkillRootStore {
  constructor(private readonly file?: string) {}

  async list(): Promise<string[]> {
    if (!this.file) return []
    try {
      const parsed: unknown = JSON.parse(await readFile(this.file, 'utf8'))
      const roots = (parsed as Partial<StoredRoots>).roots
      if (!Array.isArray(roots)) return []
      return roots
        .filter((item): item is string => typeof item === 'string' && item.length <= MAX_PATH_LENGTH)
        .slice(0, MAX_ROOTS)
    } catch {
      // 首次运行、文件损坏或权限不足都按空列表处理。
      return []
    }
  }

  async add(raw: string, home = homedir()): Promise<string[]> {
    const path = normalizeRootPath(raw)
    const absolute = expandRootPath(home, path)
    const info = await stat(absolute).catch(() => null)
    if (!info) throw new ExtensionError('路径不存在')
    if (!info.isDirectory()) throw new ExtensionError('请填写文件夹路径，而不是文件')
    const actual = await realpath(absolute).catch(() => '')
    if (!actual) throw new ExtensionError('路径无法访问')
    const current = await this.list()
    if (current.includes(path)) throw new ExtensionError('该路径已经添加')
    if (current.length >= MAX_ROOTS) throw new ExtensionError(`最多添加 ${MAX_ROOTS} 个路径`)
    for (const root of defaultSkillRoots(home)) {
      const defaultActual = await realpath(root.dir).catch(() => '')
      if (defaultActual && defaultActual === actual)
        throw new ExtensionError('该路径已包含在默认来源中')
    }
    const next = [...current, path]
    await this.save(next)
    return next
  }

  async remove(path: string): Promise<string[]> {
    const current = await this.list()
    const next = current.filter((item) => item !== path)
    if (next.length !== current.length) await this.save(next)
    return next
  }

  private async save(roots: string[]): Promise<void> {
    if (!this.file) return
    await mkdir(dirname(this.file), { recursive: true })
    const temp = `${this.file}.tmp`
    await writeFile(temp, JSON.stringify({ version: 1, roots } satisfies StoredRoots, null, 2), 'utf8')
    await rename(temp, this.file)
  }
}

/** 设置页展示用：默认来源 + 自定义路径，均带存在性。 */
export async function skillRootsView(
  store: SkillRootStore,
  home = homedir(),
  env: NodeJS.ProcessEnv = process.env
): Promise<SkillRootsView> {
  const defaults: SkillRootEntryView[] = []
  for (const root of defaultSkillRoots(home, env)) {
    // `.system` 属于 Codex 的一部分，不在设置页单列。
    if (root.id === 'codex-system') continue
    defaults.push({
      path: root.dir,
      displayPath: displayPath(home, root.dir),
      kind: 'default',
      exists: await isDirectory(root.dir),
      label: root.label
    })
  }
  const custom: SkillRootEntryView[] = []
  for (const path of await store.list()) {
    const absolute = expandRootPath(home, path)
    custom.push({
      path,
      displayPath: path,
      kind: 'custom',
      exists: await isDirectory(absolute),
      label: '自定义路径'
    })
  }
  return { defaults, custom }
}
