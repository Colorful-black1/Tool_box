import { collectTools } from '../tool-registry'
import type { AgentToolDefinition } from '../tool-registry'
import { bookTools } from './books'
import { bookmarkTools } from './bookmarks'
import { groupTools } from './groups'
import { noteTools } from './notes'
import { passwordTools } from './passwords'
import { statsTools } from './stats'
import type { AgentDeps, ToolFactory } from './deps'

/**
 * 全部工具工厂：新增一个工具域只需把工厂加进这里。
 *
 * 手机端当前是「以只读为主 + 少量写操作」的集合（14 个工具）：
 * 写操作一律经过审批门（confirm 档位）；
 * 密码箱刻意不给「保存 / 覆盖」，只给收藏与删除，理由见 `passwords.ts`。
 */
const TOOL_FACTORIES: ToolFactory[] = [
  bookTools,
  bookmarkTools,
  groupTools,
  noteTools,
  passwordTools,
  statsTools
]

export function createAgentToolSet(deps: AgentDeps): AgentToolDefinition[] {
  return collectTools(TOOL_FACTORIES.map((factory) => factory(deps)))
}

export type { AgentDeps }
