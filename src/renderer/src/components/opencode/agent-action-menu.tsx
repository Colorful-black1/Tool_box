import type { JSX, KeyboardEvent, RefObject } from 'react'
import { useEffect, useRef } from 'react'
import { Popover } from '../popover'

/** 候选统一使用文字元数据；选择行为由当前输入区控制。 */
export interface AgentActionChoice {
  id: string
  label: string
  description: string
  choose(): void
}

/** 复用 Portal 弹层，避开消息区和输入区 overflow 裁切。 */
export function AgentActionMenu({
  anchor,
  input,
  fileMode,
  title,
  query,
  onQuery,
  choices,
  active,
  setActive,
  loading,
  error,
  notices,
  onClose,
  onRefresh,
  onKeyDown,
  manual
}: {
  anchor: RefObject<HTMLDivElement | null>
  input: RefObject<HTMLTextAreaElement | null>
  fileMode: boolean
  title: string
  query: string
  onQuery(value: string): void
  choices: AgentActionChoice[]
  active: number
  setActive(value: number): void
  loading: boolean
  error: string
  notices: string[]
  onClose(): void
  onRefresh(): void
  onKeyDown(event: KeyboardEvent<HTMLElement>): void
  manual: boolean
}): JSX.Element {
  const search = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLDivElement>(null)
  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [active])
  return (
    <Popover
      anchor={anchor}
      returnFocus={input}
      onClose={onClose}
      align="left"
      placement="top"
      className="agent-actions-popover"
      matchAnchorWidth={false}
      onReady={() => {
        if (manual) search.current?.focus()
      }}
    >
      <div className="agent-actions-head">
        <span className="field-label">{title}</span>
        <span className="field-hint agent-actions-keyboard">↑↓ 选择 · Enter / Tab 确认 · Esc 关闭</span>
        <button type="button" className="btn-ghost" disabled={loading} onClick={onRefresh}>
          刷新
        </button>
      </div>
      {manual ? (
        <input
          ref={search}
          className="field-input"
          value={query}
          placeholder="搜索名称、路径或用途…"
          aria-label={`${title}搜索`}
          onChange={(event) => onQuery(event.target.value)}
          onKeyDown={onKeyDown}
          role="combobox"
          aria-expanded="true"
          aria-controls="agent-action-options"
          aria-activedescendant={choices[active] ? `agent-action-${active}` : undefined}
        />
      ) : null}
      {error ? (
        <p className="status-banner" role="alert">
          {error}
        </p>
      ) : null}
      <div
        className="agent-actions-list"
        role="listbox"
        id="agent-action-options"
        aria-label={title}
        ref={list}
      >
        {loading ? (
          <p className="field-hint" role="status">
            读取中…
          </p>
        ) : choices.length ? (
          choices.map((item, index) => (
            <button
              type="button"
              role="option"
              aria-selected={index === active}
              id={`agent-action-${index}`}
              className={`ui-dropdown-item${index === active ? ' highlighted' : ''}`}
              key={item.id}
              onMouseMove={() => setActive(index)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={item.choose}
              title={fileMode ? item.label : `${item.label}\n${item.description}`}
            >
              <span className="agent-action-label">
                {fileMode ? item.label.split(/[\\/]/).pop() : item.label}
              </span>
              <span className="field-hint agent-action-description">
                {fileMode ? item.label : item.description}
              </span>
            </button>
          ))
        ) : (
          <p className="field-hint">{query ? '没有匹配项' : '当前接入没有提供可用条目'}</p>
        )}
      </div>
      {notices.length ? (
        <div className="agent-actions-notices">
          {notices.map((notice, index) => (
            <p className="field-hint agent-action-notice" key={index}>
              {notice}
            </p>
          ))}
        </div>
      ) : null}
    </Popover>
  )
}
