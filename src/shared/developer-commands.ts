/** 命令仅供记录、检索和复制，不包含执行能力。 */
export const COMMAND_SHELLS = ['unspecified', 'any', 'bash', 'powershell', 'cmd'] as const
export const COMMAND_RISKS = ['read', 'write', 'destructive'] as const
export type CommandShell = (typeof COMMAND_SHELLS)[number]
export type CommandRisk = (typeof COMMAND_RISKS)[number]
export const COMMAND_SHELL_LABELS: Record<CommandShell, string> = {
  unspecified: '未指定',
  any: 'Shell 无关',
  bash: 'Bash',
  powershell: 'PowerShell',
  cmd: 'CMD'
}
export const COMMAND_RISK_LABELS: Record<CommandRisk, string> = {
  read: '查看',
  write: '会修改',
  destructive: '可能删除数据'
}

/** 内置和个人记录共用的展示字段；命令原文不能 trim 或规范化。 */
export interface DeveloperCommandFields {
  title: string
  command: string
  category: string
  description: string
  tags: string[]
  shell: CommandShell
  risk: CommandRisk
}
export interface DeveloperCommand extends DeveloperCommandFields {
  id: string
  archivedAtMs: number | null
}
/** 独立 kv 文档，revision 用于跨窗口写入冲突保护。 */
export interface DeveloperCommandSnapshot {
  version: 1
  revision: number
  entries: DeveloperCommand[]
  favoriteIds: string[]
}
export interface DeveloperCommandInput extends DeveloperCommandFields {
  id?: string
  expectedRevision: number
}
export interface DeveloperCommandToggle {
  id: string
  value: boolean
  expectedRevision: number
}
export type CommandLibraryView = 'all' | 'favorites' | 'mine' | 'archived'
export interface CommandFilters {
  query: string
  category: string
  shell: string
  view: CommandLibraryView
}
export const EMPTY_COMMAND_LIBRARY: DeveloperCommandSnapshot = {
  version: 1,
  revision: 0,
  entries: [],
  favoriteIds: []
}

const normalized = (text: string): string => text.normalize('NFKC').toLowerCase()

/** 搜索副本与原始正文隔离；多词 AND，标题／命令命中优先。 */
export function searchDeveloperCommands(
  entries: readonly DeveloperCommand[],
  favorites: readonly string[],
  filters: CommandFilters
): DeveloperCommand[] {
  const words = normalized(filters.query.slice(0, 100)).trim().split(/\s+/).filter(Boolean)
  const favoriteSet = new Set(favorites)
  return entries
    .filter((entry) => {
      if ((entry.archivedAtMs !== null) !== (filters.view === 'archived')) return false
      if (filters.view === 'mine' && !entry.id.startsWith('user:')) return false
      if (filters.view === 'favorites' && !favoriteSet.has(entry.id)) return false
      if (filters.category && entry.category !== filters.category) return false
      if (filters.shell && entry.shell !== filters.shell) return false
      const text = normalized(
        `${entry.title} ${entry.command} ${entry.description} ${entry.category} ${entry.tags.join(' ')}`
      )
      return words.every((word) => text.includes(word))
    })
    .map((entry, index) => {
      const primary = normalized(`${entry.title} ${entry.command}`)
      return { entry, index, score: words.filter((word) => primary.includes(word)).length }
    })
    .sort(
      (a, b) =>
        b.score - a.score ||
        Number(favoriteSet.has(b.entry.id)) - Number(favoriteSet.has(a.entry.id)) ||
        a.index - b.index
    )
    .map(({ entry }) => entry)
}
