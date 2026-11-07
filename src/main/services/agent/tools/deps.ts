import type { ImportService } from '../../library/import-service'
import type { ToolboxStore } from '../../chat-store/chat-store'
import type { AgentToolDefinition } from '../tool-registry'
import type { AgentUsageService } from '../../agent-usage/usage-service'
import type { TodoService } from '../../todo-service'
import type { KnowledgeBaseService } from '../../knowledge-base/kb-service'

/** Agent 工具可依赖的主进程服务（与 IPC handler 共用同一批 store 能力） */
export interface AgentDeps {
  store: ToolboxStore
  importService: ImportService
  todos?: TodoService
  usage?: Pick<AgentUsageService, 'query'>
  knowledge?: KnowledgeBaseService
}

export type ToolFactory = (deps: AgentDeps) => AgentToolDefinition[]
