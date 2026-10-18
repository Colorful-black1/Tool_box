import { collectTools } from '../tool-registry'
import type { AgentToolDefinition } from '../tool-registry'
import { bookTools } from './books'
import { noteTools } from './notes'
import { passwordTools } from './passwords'
import { statsTools } from './stats'
import type { AgentDeps, ToolFactory } from './deps'

/**
 * 全部工具工厂：新增一个工具域只需把工厂加进这里。
 *
 * 手机端当前是「只读 + 记事本写入」的最小集合（7 个读工具 + notes_save），
 * 写操作一律经过审批门（confirm 档位）；
 * 密码箱刻意保持只读，理由见 `passwords.ts`。
 */
const TOOL_FACTORIES: ToolFactory[] = [bookTools, noteTools, passwordTools, statsTools]

export function createAgentToolSet(deps: AgentDeps): AgentToolDefinition[] {
  return collectTools(TOOL_FACTORIES.map((factory) => factory(deps)))
}

export type { AgentDeps }
