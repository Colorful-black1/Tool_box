/**
 * 技能与 MCP：只读视图与在线检索的共享契约。
 *
 * 本版本不安装、不启停、不写任何 Agent 配置；在线结果只提供可复制的命令，
 * 由用户自己在终端执行。渲染层拿到的永远是视图对象，不含密钥。
 */

/** 会读取技能 / MCP 的 Agent；`universal` 是多个 Agent 共用的通用目录。 */
export const EXTENSION_AGENTS = {
  claude: 'Claude Code',
  codex: 'Codex',
  opencode: 'OpenCode',
  dsh: 'DeepSeek Harness',
  'claude-desktop': 'Claude Desktop',
  gemini: 'Gemini CLI',
  cursor: 'Cursor',
  vscode: 'VS Code',
  universal: '通用目录'
} as const

export type ExtensionAgentId = keyof typeof EXTENSION_AGENTS

/** 使用固定顺序，界面筛选与校验都按同一份枚举。 */
export const EXTENSION_AGENT_IDS = Object.keys(EXTENSION_AGENTS) as ExtensionAgentId[]

/** 来源状态不把「没装」「读不了」和「空目录」混为一谈。 */
export type ExtensionSourceStatus = 'ready' | 'empty' | 'missing' | 'error' | 'partial'

export interface ExtensionSourceView {
  id: string
  label: string
  path: string
  displayPath: string
  count: number
  status: ExtensionSourceStatus
  detail: string
}

/** 一个物理技能目录；同名不同路径会各占一条，由界面分组展示。 */
export interface SkillEntryView {
  name: string
  description: string
  path: string
  displayPath: string
  /** 命中的根目录，如 `~/.agents/skills`。 */
  root: string
  agents: ExtensionAgentId[]
  /** Codex 自带的 `.system` 技能，不计入用户安装。 */
  bundled: boolean
  /** 同一名称存在多份不同目录时为 true。 */
  conflict: boolean
  /** 仅在冲突组内计算，用于判断两份是否真的不同。 */
  contentHash: string | null
}

export interface SkillScanResult {
  skills: SkillEntryView[]
  sources: ExtensionSourceView[]
  scannedAt: string
  notices: string[]
}

/** 技能扫描路径：默认来源固定，自定义路径由用户配置。 */
export interface SkillRootEntryView {
  path: string
  displayPath: string
  kind: 'default' | 'custom'
  exists: boolean
  /** 默认来源对应的 Agent / 说明；自定义路径为空。 */
  label: string
}

export interface SkillRootsView {
  defaults: SkillRootEntryView[]
  custom: SkillRootEntryView[]
}

export const MCP_TRANSPORTS = ['stdio', 'http', 'sse', 'unknown'] as const
export type McpTransport = (typeof MCP_TRANSPORTS)[number]

/**
 * 一处 MCP 配置。command 只回可执行名，env / headers 只回键名，
 * 值一律不出主进程。
 */
export interface McpEntryView {
  name: string
  transport: McpTransport
  command: string | null
  argCount: number | null
  urlHost: string | null
  envKeys: string[]
  headerKeys: string[]
  enabled: boolean
  agent: ExtensionAgentId
  sourceId: string
  sourceLabel: string
  sourceDisplay: string
  /** 同名服务在不同来源里启动方式不同。 */
  conflict: boolean
}

export interface McpScanResult {
  servers: McpEntryView[]
  sources: ExtensionSourceView[]
  scannedAt: string
  notices: string[]
}

/** skills.sh 的搜索要求至少 2 个字符。 */
export const SKILL_SEARCH_MIN_CHARS = 2
export const SKILL_SEARCH_MAX_CHARS = 64
export const EXTENSION_SEARCH_LIMIT = 20
export const EXTENSION_SEARCH_MAX_LIMIT = 50

export interface SkillSearchInput {
  query: string
  limit?: number
  offset?: number
}

export interface SkillSearchItem {
  /** `owner/repo:skill`。 */
  id: string
  name: string
  source: string
  installs: number
  repositoryUrl: string
  /** 可直接粘贴执行；不包含任何需要转义的字符，命令由主进程拼好。 */
  installCommand: string
}

export interface SkillSearchResult {
  query: string
  items: SkillSearchItem[]
  hasMore: boolean
}

export interface McpSearchInput {
  query: string
  limit?: number
  cursor?: string
}

export interface McpSearchItem {
  name: string
  title: string
  description: string
  version: string
  transport: McpTransport
  /** 启动命令，如 `npx -y @scope/pkg@1.0.0`；远程服务为 null。 */
  commandLine: string | null
  /** 可直接粘贴进 mcpServers 的 JSON；必填 env 用占位符。 */
  configSnippet: string
  repositoryUrl: string | null
  remoteUrl: string | null
}

export interface McpSearchResult {
  query: string
  items: McpSearchItem[]
  nextCursor: string | null
}

/** 在线检索失败时带用户可读原因的显式错误。 */
export class ExtensionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ExtensionError'
  }
}
