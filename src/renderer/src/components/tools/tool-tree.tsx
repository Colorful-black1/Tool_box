/**
 * 工具树：主树（分支）→ 工具（叶子）。
 *
 * 现在的结构是「开发者工具」这一棵主树；将来要加「日常工具」之类，
 * 只需在注册表里再加一个分组，这里不用改。
 */
import { useState } from 'react'
import type { JSX } from 'react'

import type { ToolGroup } from './registry'

export interface ToolTreeProps {
  groups: ToolGroup[]
  /** 当前选中的工具 id */
  activeId: string
  onSelect: (toolId: string) => void
}

export function ToolTree({ groups, activeId, onSelect }: ToolTreeProps): JSX.Element {
  // 默认全部展开：主树不多，折叠反而让人多点一次
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})

  return (
    <nav className="tools-tree" aria-label="工具目录">
      {groups.map((group) => {
        const isCollapsed = collapsed[group.id] === true
        return (
          <div key={group.id} className="tools-tree-group">
            <button
              type="button"
              className="tools-tree-branch"
              aria-expanded={!isCollapsed}
              onClick={() =>
                setCollapsed((current) => ({ ...current, [group.id]: !isCollapsed }))
              }
            >
              <span className={`tools-tree-caret${isCollapsed ? ' collapsed' : ''}`} aria-hidden="true">
                ▾
              </span>
              <span className="tools-tree-branch-name">{group.name}</span>
            </button>
            {!isCollapsed ? (
              <div className="tools-tree-children">
                {group.tools.map((tool) => (
                  <button
                    key={tool.id}
                    type="button"
                    className={`tools-tree-leaf${tool.id === activeId ? ' active' : ''}`}
                    aria-current={tool.id === activeId ? 'page' : undefined}
                    title={tool.description}
                    onClick={() => onSelect(tool.id)}
                  >
                    {tool.name}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        )
      })}
    </nav>
  )
}
