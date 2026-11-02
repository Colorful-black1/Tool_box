import type { AgentContextUsage, AgentQuestionRequest, AgentTurnTiming } from './agent-session'
import type { SessionMessage } from './coding-agent-messages'

export type { SessionMessage }

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
  contextUsage?: AgentContextUsage
  timing?: AgentTurnTiming
  questions?: AgentQuestionRequest[]
  /** 只在原生分页历史支持对话回退时启用；不包含文件恢复。 */
  canRevert?: boolean
  historyRevision?: string
  /** 只包含最近一页；更早内容按 `messageWindow.earliestSeq` 分页回取。 */
  messages: SessionMessage[]
  /** 尾页窗口元信息；旧桥接可能缺失，缺失时视为已完整显示。 */
  messageWindow?: CodingAgentMessageWindow
  /** 超出本机存储预算被丢弃的条数；由主进程维护，不从渲染层写入。 */
  truncatedMessages?: number
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

/**
 * 编程工作台显示的项目 Git 状态。
 *
 * 只读：分支、跟踪差距、改动文件数与增删行（未跟踪文件计入改动数、不计入行数）。
 * `directory` 是用户选择的项目目录，不一定是仓库根。
 */
export interface GitStatusView {
  directory: string
  branch: string
  detached: boolean
  ahead: number
  behind: number
  changedFiles: number
  insertions: number
  deletions: number
}

/** 尾页窗口：界面据 hasMore 决定是否继续向上加载。 */
export interface CodingAgentMessageWindow {  hasMore: boolean
  earliestSeq: number | null
  latestSeq: number | null
  totalMessages: number
  /** 超出本机存储预算被丢弃的条数；大于 0 时界面必须显式提示。 */
  truncated: number
}

/** 按 seq 回取更早的一页；不传 beforeSeq 时返回尾页。 */
export interface CodingAgentMessagesInput extends CodingAgentSessionInput {
  beforeSeq?: number
}

export interface CodingAgentMessagesPage {
  messages: SessionMessage[]
  hasMore: boolean
  truncated: number
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

/** 预览凭据只在原窗口、连接、会话和当前历史有效，执行后即消费。 */
export interface CodingAgentRevertPreview {
  token: string
  historyRevision: string
  affectedTurns: number
  affectedMessages: number
  tail: Array<{ role: 'user' | 'assistant'; content: string }>
  originalText: string
}

/** messageId 是当前显示消息的本地引用，由适配器映射到原生轮次。 */
export interface CodingAgentRevertInput extends CodingAgentSessionInput {
  messageId: string
}
