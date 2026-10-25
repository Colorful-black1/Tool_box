/**
 * 工具树：主树（分支）→ 工具（叶子）。
 *
 * 现在的结构是「开发者工具」这一棵主树；将来要加「日常工具」之类，
 * 只需在注册表里再加一个分组，这里不用改。
 */
import { useState } from 'react'
import type { JSX } from 'react'

import type { ToolGroup } from './registry'
import type { ToolPlacement } from './tool-navigation'
import { DragHandleIcon, FavoriteIcon } from '../icons'

export interface ToolTreeProps {
  groups: ToolGroup[]
  /** 当前选中的工具 id */
  activeId: string
  onSelect: (toolId: string) => void
  searching: boolean
  editable: boolean
  onMove: (sourceId: string, targetId: string, placement: ToolPlacement) => void
  favorites: string[]
  shortcutsReady: boolean
  onFavorite(id: string): void
}

export function ToolTree({
  groups,
  activeId,
  onSelect,
  searching,
  editable,
  onMove,
  favorites,
  shortcutsReady,
  onFavorite
}: ToolTreeProps): JSX.Element {
  // 默认全部展开：主树不多，折叠反而让人多点一次
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [dragging, setDragging] = useState<{ id: string; groupId: string } | null>(null)
  const [drop, setDrop] = useState<{ id: string; placement: ToolPlacement } | null>(null)
  const clearDrag = (): void => {
    setDragging(null)
    setDrop(null)
  }

  return (
    <nav className="tools-tree" aria-label="工具目录">
      {groups.map((group) => {
        const isCollapsed = !searching && collapsed[group.id] === true
        return (
          <div key={group.id} className="tools-tree-group">
            <button
              type="button"
              className="tools-tree-branch"
              aria-expanded={!isCollapsed}
              disabled={searching}
              onClick={() => setCollapsed((current) => ({ ...current, [group.id]: !isCollapsed }))}
            >
              <span
                className={`tools-tree-caret${isCollapsed ? ' collapsed' : ''}`}
                aria-hidden="true"
              >
                ▾
              </span>
              <span className="tools-tree-branch-name">{group.name}</span>
            </button>
            {!isCollapsed ? (
              <div className="tools-tree-children">
                {group.tools.map((tool, index) => (
                  <div
                    key={tool.id}
                    className={`tools-tree-item${dragging?.id === tool.id ? ' dragging' : ''}`}
                    data-drop={drop?.id === tool.id ? drop.placement : undefined}
                    onDragOver={(event) => {
                      if (
                        !editable ||
                        !dragging ||
                        dragging.groupId !== group.id ||
                        dragging.id === tool.id
                      )
                        return
                      event.preventDefault()
                      event.dataTransfer.dropEffect = 'move'
                      const box = event.currentTarget.getBoundingClientRect()
                      const placement =
                        event.clientY < box.top + box.height / 2 ? 'before' : 'after'
                      setDrop((current) =>
                        current?.id === tool.id && current.placement === placement
                          ? current
                          : { id: tool.id, placement }
                      )
                    }}
                    onDrop={(event) => {
                      if (!editable || !dragging || dragging.groupId !== group.id) return
                      event.preventDefault()
                      const box = event.currentTarget.getBoundingClientRect()
                      onMove(
                        dragging.id,
                        tool.id,
                        event.clientY < box.top + box.height / 2 ? 'before' : 'after'
                      )
                      clearDrag()
                    }}
                  >
                    <button
                      type="button"
                      className={`tools-tree-leaf${tool.id === activeId ? ' active' : ''}`}
                      aria-current={tool.id === activeId ? 'page' : undefined}
                      title={tool.description}
                      onClick={() => onSelect(tool.id)}
                    >
                      {tool.name}
                    </button>
                    <button
                      type="button"
                      className="icon-btn tools-favorite"
                      aria-label={`${favorites.includes(tool.id) ? '取消收藏' : '收藏'}${tool.name}`}
                      aria-pressed={favorites.includes(tool.id)}
                      disabled={!shortcutsReady}
                      onClick={() => onFavorite(tool.id)}
                    >
                      <FavoriteIcon />
                    </button>
                    <button
                      type="button"
                      className="icon-btn tools-drag-handle"
                      aria-label={`调整${tool.name}顺序`}
                      aria-describedby="tools-order-hint"
                      title="拖动排序；Alt+↑/↓ 调整位置"
                      aria-disabled={!editable}
                      draggable={editable}
                      onDragStart={(event) => {
                        if (!editable) {
                          event.preventDefault()
                          return
                        }
                        event.dataTransfer.effectAllowed = 'move'
                        event.dataTransfer.setData('application/x-toolbox-tool', tool.id)
                        setDragging({ id: tool.id, groupId: group.id })
                      }}
                      onDragEnd={clearDrag}
                      onKeyDown={(event) => {
                        if (
                          !editable ||
                          !event.altKey ||
                          !['ArrowUp', 'ArrowDown'].includes(event.key)
                        )
                          return
                        event.preventDefault()
                        const before = event.key === 'ArrowUp'
                        const target = group.tools[index + (before ? -1 : 1)]
                        if (target) onMove(tool.id, target.id, before ? 'before' : 'after')
                      }}
                    >
                      <DragHandleIcon />
                    </button>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        )
      })}
    </nav>
  )
}
