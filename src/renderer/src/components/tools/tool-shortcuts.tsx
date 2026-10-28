import type { JSX } from 'react'
import {
  MAX_TOOL_FAVORITES,
  VISIBLE_TOOL_RECENT,
  readToolIds
} from '../../../../shared/tool-shortcuts'
import type { ToolDefinition } from './registry'

/** 重复入口只引用同一工具 ID；不提供拖放，也不再次渲染工具面板。 */
export function ToolShortcuts({
  tools,
  favorites,
  recent,
  activeId,
  onSelect
}: {
  tools: ToolDefinition[]
  favorites: string[]
  recent: string[]
  activeId: string
  onSelect(id: string): void
}): JSX.Element {
  const known = new Map(tools.map((tool) => [tool.id, tool]))
  const groups = [
    {
      label: '收藏',
      ids: readToolIds(favorites, MAX_TOOL_FAVORITES).filter((id) => known.has(id))
    },
    {
      label: '最近使用',
      ids: readToolIds(recent, recent.length)
        .filter((id) => known.has(id))
        .slice(0, VISIBLE_TOOL_RECENT)
    }
  ]
  return (
    <div className="tools-shortcuts">
      {groups.map((group) => (
        <section
          className="tools-shortcut-section"
          aria-label={`${group.label}工具`}
          key={group.label}
        >
          <h3>{group.label}</h3>
          {!group.ids.length ? (
            <p>{group.label === '收藏' ? '点击工具旁的星标收藏' : '打开工具后显示在这里'}</p>
          ) : (
            group.ids.map((id) => (
              <button
                key={id}
                type="button"
                className={`btn-ghost tools-shortcut-link${id === activeId ? ' active' : ''}`}
                aria-label={`打开${group.label}的${known.get(id)!.name}`}
                title={known.get(id)!.description}
                onClick={() => onSelect(id)}
              >
                {known.get(id)!.name}
              </button>
            ))
          )}
        </section>
      ))}
    </div>
  )
}
