/** 仅在明确的输入位置触发候选，不将邮件或代码块内的符号解释成引用。 */
export function agentInputTrigger(
  text: string,
  cursor: number
): {
  kind: 'files' | 'commands'
  query: string
  start: number
  end: number
} | null {
  const prefix = text.slice(0, cursor)
  if (
    (prefix.match(/```/g)?.length ?? 0) % 2 ||
    (prefix.split('\n').at(-1)?.match(/`/g)?.length ?? 0) % 2
  )
    return null
  const slash = /^\/([\w:.-]*)$/.exec(prefix)
  if (slash) return { kind: 'commands', query: slash[1], start: 0, end: cursor }
  const file = /(?:^|\s)@([^\s@]*)$/.exec(prefix)
  if (file)
    return { kind: 'files', query: file[1], start: cursor - file[1].length - 1, end: cursor }
  return null
}

/** 原生客户端与工具箱的本地快捷操作集中映射，不发模型任务。 */
export const LOCAL_AGENT_COMMANDS = [
  {
    name: 'new',
    aliases: ['clear'],
    label: '新对话',
    description: '工具箱快捷入口 · 保留当前历史'
  },
  {
    name: 'history',
    aliases: ['resume', 'sessions'],
    label: '历史会话',
    description: '工具箱快捷入口 · 打开项目历史'
  },
  {
    name: 'model',
    aliases: ['models'],
    label: '选择模型',
    description: '工具箱快捷入口 · 打开已有模型选项'
  },
  {
    name: 'permissions',
    aliases: [],
    label: '操作权限',
    description: '工具箱快捷入口 · 打开已有权限选项'
  },
  { name: 'skills', aliases: [], label: '选择 Skill', description: '读取当前 Agent 的可用 Skill' },
  { name: 'mcp', aliases: [], label: 'MCP 工具', description: '查看服务、工具和可用 Prompt' }
] as const

export type LocalAgentCommand = (typeof LOCAL_AGENT_COMMANDS)[number]['name']

export function localAgentCommand(name: string): LocalAgentCommand | undefined {
  return LOCAL_AGENT_COMMANDS.find(
    (item) => item.name === name || item.aliases.some((alias: string) => alias === name)
  )?.name
}
