/**
 * 工具页：左侧树（主树 → 工具），右侧当前工具的面板。
 *
 * 选中的工具记在 app-store 里，切走再切回来仍是同一个；
 * 命令面板（⌘K）也能直接跳到某个工具。
 */
import type { JSX } from 'react'

import { useAppStore } from '../../stores/app-store'
import { ToolTree } from './tool-tree'
import { DEFAULT_TOOL_ID, findGroupOfTool, findTool, TOOL_GROUPS } from './registry'

export function ToolsPage(): JSX.Element {
  const activeId = useAppStore((state) => state.toolsActiveId)
  const setToolsActive = useAppStore((state) => state.setToolsActive)

  const tool = findTool(activeId ?? DEFAULT_TOOL_ID) ?? TOOL_GROUPS[0].tools[0]
  const group = findGroupOfTool(tool.id)

  return (
    <div className="tools-layout view-enter">
      <aside className="tools-side">
        {group ? <p className="tools-side-caption">{group.description}</p> : null}
        <ToolTree
          groups={TOOL_GROUPS}
          activeId={tool.id}
          onSelect={(toolId) => setToolsActive(toolId)}
        />
      </aside>

      <section className="tool-panel">
        <header className="tool-panel-head">
          <h2 className="tool-panel-title">{tool.name}</h2>
          <p className="tool-panel-desc">{tool.description}</p>
        </header>
        {tool.render()}
      </section>
    </div>
  )
}
