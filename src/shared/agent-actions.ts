import type { CodingAgentId, CodingAgentSessionInput } from './coding-agents'

/** 引用只在所属项目和当前能力目录内有效，不携带原生配置或凭据。 */
export interface AgentReference {
  id: string
  kind: 'file' | 'skill' | 'tool'
  label: string
}

/** 原生命令与工具箱工作流分开展示，避免把普通提示冒充协议操作。 */
export interface AgentCommand {
  id: string
  name: string
  description: string
  argumentHint: string
  kind: 'native' | 'workflow'
  targetFile?: 'AGENTS.md' | 'CLAUDE.md'
}

/** 仅输出白名单元数据；不返回 MCP URL、环境变量、认证信息和原始错误。 */
export interface AgentMcpServer {
  name: string
  status: string
  tools: Array<AgentReference & { description: string }>
}

/** 会话可用能力快照；查询失败与原生未提供必须明确区分。 */
export interface AgentCatalog {
  connectionId: string
  sessionId: string
  commands: AgentCommand[]
  skills: Array<AgentReference & { description: string }>
  mcp: AgentMcpServer[]
  notices: string[]
  extensionsEnabled: boolean
}

/** 能力读取不创建会话；无会话时仅发现运行时允许的元数据。 */
export interface AgentCatalogInput {
  runtimeId: CodingAgentId
  sessionId?: string
}

/** 文件搜索范围来自已选项目，不开放任意文件读取。 */
export interface AgentFileSearchInput {
  runtimeId: CodingAgentId
  directory: string
  query: string
}

/** 搜索只返回路径标签，文件内容仍由原生 Agent 按权限读取。 */
export interface AgentFileSearchResult {
  files: AgentReference[]
  limited: boolean
}

/** 旧 content 调用保持兼容；引用及普通文字发送意图在主进程复核。 */
export interface AgentSendInput extends CodingAgentSessionInput {
  content: string
  references?: AgentReference[]
  literal?: boolean
}

/** commandId 必须来自同连接、同会话的最新目录。 */
export interface AgentCommandInput extends CodingAgentSessionInput {
  commandId: string
  arguments: string
}
