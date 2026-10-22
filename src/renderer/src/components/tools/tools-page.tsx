/**
 * 工具页：左侧树（主树 → 工具），右侧当前工具的面板。
 *
 * 选中的工具记在 app-store 里，切走再切回来仍是同一个；
 * 命令面板（⌘K）也能直接跳到某个工具。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { JSX } from 'react'

import { useAppStore } from '../../stores/app-store'
import { ToolTree } from './tool-tree'
import { DEFAULT_TOOL_ID, findGroupOfTool, findTool, TOOL_GROUPS } from './registry'
import { filterToolGroups, moveTool, orderToolGroups } from './tool-navigation'
import { useToolOrderStore } from '../../stores/tool-order-store'
import { CloseIcon, SearchIcon } from '../icons'

export function ToolsPage(): JSX.Element {
  const activeId = useAppStore((state) => state.toolsActiveId)
  const setToolsActive = useAppStore((state) => state.setToolsActive)
  const order = useToolOrderStore((state) => state.order)
  const loaded = useToolOrderStore((state) => state.loaded)
  const loading = useToolOrderStore((state) => state.loading)
  const saving = useToolOrderStore((state) => state.saving)
  const error = useToolOrderStore((state) => state.error)
  const message = useToolOrderStore((state) => state.message)
  const load = useToolOrderStore((state) => state.load)
  const save = useToolOrderStore((state) => state.save)
  const [query, setQuery] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)
  const orderedGroups = useMemo(() => orderToolGroups(TOOL_GROUPS, order), [order])
  const visibleGroups = useMemo(
    () => filterToolGroups(orderedGroups, query),
    [orderedGroups, query]
  )
  const searching = query.trim().length > 0
  const editable = loaded && !saving && !searching

  useEffect(() => {
    void load()
  }, [load])

  const tool = findTool(activeId ?? DEFAULT_TOOL_ID) ?? TOOL_GROUPS[0].tools[0]
  const group = findGroupOfTool(tool.id)
  const selectTool = (toolId: string): void => {
    if (toolId === tool.id) return
    if (
      useAppStore.getState().hasUnsavedChanges &&
      !window.confirm('当前模板有未保存的修改，是否放弃模板修改并切换工具？')
    )
      return
    setToolsActive(toolId)
  }

  return (
    <div className="tools-layout view-enter">
      <aside className="tools-side">
        <div className="tools-search">
          <SearchIcon />
          <input
            ref={searchRef}
            className="field-input"
            type="search"
            maxLength={100}
            aria-label="搜索开发者工具"
            placeholder="搜索工具名称或功能"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return
              if (event.key === 'Escape' && query) {
                event.preventDefault()
                event.stopPropagation()
                setQuery('')
              } else if (event.key === 'Enter' && visibleGroups[0]?.tools[0]) {
                event.preventDefault()
                selectTool(visibleGroups[0].tools[0].id)
              }
            }}
          />
          {query ? (
            <button
              type="button"
              className="icon-btn"
              aria-label="清空工具搜索"
              onClick={() => {
                setQuery('')
                searchRef.current?.focus()
              }}
            >
              <CloseIcon />
            </button>
          ) : null}
        </div>
        {group ? <p className="tools-side-caption">{group.description}</p> : null}
        <p className="tools-side-caption" id="tools-order-hint" role="status">
          {searching
            ? `匹配 ${visibleGroups.reduce((sum, item) => sum + item.tools.length, 0)} 个工具 · 清空搜索后可排序`
            : saving
              ? '正在保存工具顺序…'
              : loading
                ? '正在读取工具顺序…'
                : message || '拖动右侧手柄排序 · Alt+↑/↓'}
        </p>
        {error ? (
          <div className="status-banner tools-order-error" role="alert">
            <span>{error}</span>
            {!loaded ? (
              <button
                type="button"
                className="btn-ghost"
                disabled={loading}
                onClick={() => void load()}
              >
                重试读取
              </button>
            ) : null}
          </div>
        ) : null}
        {!visibleGroups.length ? (
          <p className="tools-search-empty" role="status">
            没有匹配的工具，试试名称、用途或英文标识。
          </p>
        ) : null}
        <ToolTree
          groups={visibleGroups}
          activeId={tool.id}
          onSelect={selectTool}
          searching={searching}
          editable={editable}
          onMove={(sourceId, targetId, placement) => {
            if (!editable) return
            const sourceGroup = orderedGroups.find((item) =>
              item.tools.some((item) => item.id === sourceId)
            )
            if (!sourceGroup?.tools.some((item) => item.id === targetId)) return
            const next = orderedGroups.flatMap((item) => {
              const ids = item.tools.map((entry) => entry.id)
              return item === sourceGroup ? moveTool(ids, sourceId, targetId, placement) : ids
            })
            void save(next)
          }}
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
