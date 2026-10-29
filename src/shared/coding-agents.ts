/** 首版每种工具一个默认原生 profile；运行时和模型分别选择。 */
export const CODING_AGENT_IDS = ['opencode', 'codex', 'kimi', 'claude', 'claude-desktop', 'dsh'] as const
export type CodingAgentId = (typeof CODING_AGENT_IDS)[number]
/** 当前有真实适配器的工作台入口；预留 Kimi 不混入可操作选项。 */
export const WORKBENCH_AGENT_IDS = ['opencode', 'codex', 'claude', 'claude-desktop', 'dsh'] as const
export type CodingAgentCapability = 'unknown' | 'supported' | 'unsupported'
export const CODING_AGENT_NAMES: Record<CodingAgentId, string> = {
  opencode: 'OpenCode',
  codex: 'Codex',
  kimi: 'Kimi Code',
  claude: 'Claude Code',
  'claude-desktop': 'Claude Desktop',
  dsh: 'DeepSeek Harness'
}

/** 接口可观测性独立于运行时自身是否具有该功能。 */
export interface CodingAgentCapabilities {
  history: CodingAgentCapability
  resume: CodingAgentCapability
  subagents: CodingAgentCapability
  stopSubagent: CodingAgentCapability
  usage: CodingAgentCapability
  desktopHistory: CodingAgentCapability
}

/** 不包含认证响应、原始配置或供应商密钥的运行时快照。 */
export interface CodingAgentRuntimeView {
  runtimeId: CodingAgentId
  name: string
  executablePath: string | null
  directory: string
  /** 最近明确选择的项目，不代表当前原生连接目录；缺失时兼容旧桥接。 */
  projectDirectory?: string
  projectError?: string
  version: string | null
  connected: boolean
  connectionId: string
  available: boolean
  detail: string
  canLoadSession: boolean
  visibleModelIds: string[]
  capabilities: CodingAgentCapabilities
}

/** 仅允许从原生选项中选择，不向 renderer 暴露任意配置接口。 */
export interface CodingAgentOption {
  id: string
  name: string
  category: string
  currentValue: string
  options: Array<{ value: string; label: string }>
}

/** 单次审批标识只在其原会话、连接和运行中有效。 */
export interface CodingAgentApproval {
  id: string
  title: string
  details: string
  canAllow: boolean
}

/** 公开接口确实提供的原生子任务；未知状态不能冒充成功。 */
export interface CodingAgentSubtask {
  id: string
  title: string
  status: string
  result: string
}

/** id 是本地 sessionRef，nativeSessionId 仅由对应适配器解释。 */
export interface CodingAgentSessionView {
  id: string
  nativeSessionId: string
  runtimeId: CodingAgentId
  connectionId: string
  runId: string | null
  revision: number
  title: string
  directory: string
  status: 'ready' | 'running' | 'stopping' | 'disconnected' | 'error'
  outcome: 'completed' | 'stopped' | 'failed' | 'unknown' | null
  messages: Array<{ id: string; role: 'user' | 'assistant'; content: string }>
  tools: Array<{ id: string; title: string; status: string }>
  options: CodingAgentOption[]
  approvals: CodingAgentApproval[]
  subtasks: CodingAgentSubtask[]
  error: string
}

/** 历史摘要不创建本地执行会话；用户选择后才能恢复。 */
export interface CodingAgentSessionSummary {
  id: string
  title: string
}

/** DSH 工作区归组结果；message 为界面可展示的说明。 */
export interface CodingAgentWorkspaceResult {
  workspace: string
  message: string
}

/** revision 在一次连接内单调递增；只发送到拥有连接的窗口。 */
export type CodingAgentEvent =
  | { kind: 'runtime'; runtime: CodingAgentRuntimeView; revision: number }
  | { kind: 'session'; session: CodingAgentSessionView }

/** 新建、恢复和发送是独立意图，缺失 id 不被当作新建。 */
export interface CodingAgentSessionInput {
  runtimeId: CodingAgentId
  sessionId: string
}
