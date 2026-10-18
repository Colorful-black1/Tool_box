import type { AgentToolDefinition } from '../tool-registry'
import type { MobileStore } from '../../data/store'

/**
 * Agent 工具可依赖的能力。
 *
 * 手机端只有数据层一个依赖：没有 `ImportService`（手机端不按路径导入书籍，
 * 导入走 SAF 文件选择器，由书架页面负责），也没有桌面端的文件系统能力。
 */
export interface AgentDeps {
  store: MobileStore
}

export type ToolFactory = (deps: AgentDeps) => AgentToolDefinition[]
