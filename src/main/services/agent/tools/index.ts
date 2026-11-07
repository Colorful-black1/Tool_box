import { collectAgentTools } from '../tool-registry'
import type { AgentToolDefinition } from '../tool-registry'
import { bookTools } from './books'
import { bookmarkTools } from './bookmarks'
import { groupTools } from './groups'
import { noteTools } from './notes'
import { passwordTools } from './passwords'
import { statsTools } from './stats'
import type { AgentDeps, ToolFactory } from './deps'
import { todoTools } from './todos'
import { usageTools } from './usage'
import { noteEditTools } from './note-edit'
import { workspaceTools } from './workspace'
import { resultReferences } from './result-references'
import { commandTools } from './commands'
import { knowledgeTools } from './knowledge'

/** 全部工具工厂：新增一个工具域只需把工厂加进这里 */
const TOOL_FACTORIES: ToolFactory[] = [
  bookTools,
  groupTools,
  bookmarkTools,
  noteTools,
  passwordTools,
  statsTools,
  todoTools,
  usageTools,
  noteEditTools,
  workspaceTools,
  commandTools,
  knowledgeTools
]

export function createAgentToolSet(deps: AgentDeps): AgentToolDefinition[] {
  return collectAgentTools(TOOL_FACTORIES.flatMap((factory) => factory(deps))).map(
    (definition) => ({
      ...definition,
      references:
        definition.references ?? ((_input, result) => resultReferences(definition.name, result))
    })
  )
}

export type { AgentDeps }
