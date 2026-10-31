import type { AgentCommand, AgentMcpServer } from '../../../shared/agent-actions'

/** 主进程内部保留原生路径，renderer 仅接收不透明引用。 */
export interface NativeAgentCatalog {
  commands: Array<Omit<AgentCommand, 'id' | 'kind'>>
  skills: Array<{ name: string; description: string; path: string }>
  mcp: Array<
    Omit<AgentMcpServer, 'tools'> & {
      tools: Array<{ name: string; description: string }>
    }
  >
  notices: string[]
  extensionsEnabled?: boolean
  /** 原生已禁用的 Skill 不得通过本机路径引用重新出现。 */
  disabledSkillNames?: string[]
}

/** 非终端界面不提供改变身份、认证、权限或文件回滚的原生快捷命令。 */
const LOCAL_OR_UNSAFE = new Set([
  'new',
  'clear',
  'reset',
  'exit',
  'quit',
  'q',
  'login',
  'logout',
  'theme',
  'themes',
  'terminal-setup',
  'permissions',
  'permission',
  'model',
  'models',
  'resume',
  'sessions',
  'history',
  'cd',
  'add-dir',
  'undo',
  'redo',
  'rewind',
  'delete',
  'archive',
  'share',
  'unshare',
  'export',
  'plugin',
  'plugins',
  'mcp',
  'skills',
  'config',
  'settings'
])

/** 列表来源不可信：限制条数、命令名及文案，丢弃终端专属入口。 */
export function nativeCommands(value: unknown): NativeAgentCatalog['commands'] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  return value.slice(0, 300).flatMap((raw: unknown) => {
    if (!raw || typeof raw !== 'object') return []
    const item = raw as Record<string, unknown>
    const name = typeof item.name === 'string' ? item.name : ''
    if (!/^[\w:.-]{1,120}$/.test(name) || LOCAL_OR_UNSAFE.has(name) || seen.has(name)) return []
    seen.add(name)
    const input =
      item.input && typeof item.input === 'object' ? (item.input as Record<string, unknown>) : null
    return [
      {
        name,
        description: typeof item.description === 'string' ? item.description.slice(0, 500) : name,
        argumentHint:
          typeof item.argumentHint === 'string'
            ? item.argumentHint.slice(0, 200)
            : typeof input?.hint === 'string'
              ? input.hint.slice(0, 200)
              : '',
        ...(name === 'init' ? { targetFile: 'AGENTS.md' as const } : {})
      }
    ]
  })
}

export function unavailableCatalog(notice: string): NativeAgentCatalog {
  return { commands: [], skills: [], mcp: [], notices: [notice] }
}
