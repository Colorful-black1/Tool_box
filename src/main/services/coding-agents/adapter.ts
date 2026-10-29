import type {
  CodingAgentId,
  CodingAgentRuntimeView,
  CodingAgentSessionSummary,
  CodingAgentSessionView,
  CodingAgentWorkspaceResult
} from '../../../shared/coding-agents'
import type { NativeAgentCatalog } from './agent-action-catalog'
import type { AgentQuestionAnswer } from '../../../shared/agent-session'

/** 引用由统一服务校验后转换；不接受 renderer 提交的原生路径。 */
export interface NativeSendContext {
  files?: string[]
  skills?: Array<{ name: string; path: string }>
  command?: boolean
}

/** 适配器使用原生 ID；本地引用、连接所有权和顶层运行由统一服务管理。 */
export type NativeCodingSession = Omit<
  CodingAgentSessionView,
  'runtimeId' | 'nativeSessionId' | 'connectionId' | 'runId' | 'revision' | 'outcome' | 'subtasks'
> & {
  outcome?: CodingAgentSessionView['outcome']
  subtasks?: CodingAgentSessionView['subtasks']
}
export type NativeCodingEvent =
  | { kind: 'connection'; connected: boolean }
  | { kind: 'session'; session: NativeCodingSession }
  | { kind: 'runtime'; runtime: Omit<CodingAgentRuntimeView, 'connectionId'> }

/** 返回普通视图；不向 renderer 暴露原生 RPC 或认证数据。 */
export interface CodingAgentAdapter {
  readonly id: CodingAgentId
  inspect(): Promise<Omit<CodingAgentRuntimeView, 'connectionId'>>
  selectExecutable(path: string): Promise<Omit<CodingAgentRuntimeView, 'connectionId'>>
  connect(directory: string): Promise<Omit<CodingAgentRuntimeView, 'connectionId'>>
  disconnect(): void
  listSessions(): Promise<CodingAgentSessionSummary[]>
  attachWorkspace?(sessionId: string, directory: string): Promise<CodingAgentWorkspaceResult>
  openSession(id?: string): Promise<NativeCodingSession>
  setOption(id: string, optionId: string, value: string): Promise<NativeCodingSession>
  send(id: string, content: string, context?: NativeSendContext): void | Promise<void>
  catalog?(id?: string): Promise<NativeAgentCatalog>
  compact?(id: string): Promise<void>
  setExtensions?(directory: string, enabled: boolean): void
  stop(id: string): void | Promise<void>
  approve(id: string, approvalId: string, approved: boolean): void
  answerQuestion?(id: string, answer: AgentQuestionAnswer): void
  subscribe(listener: (event: NativeCodingEvent) => void): () => void
}

/** 只允许由本项目创建的可读文案跨 IPC，不透传第三方错误原文。 */
export class CodingAgentError extends Error {}
