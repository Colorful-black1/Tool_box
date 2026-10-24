/**
 * 命令面板（⌘K / Ctrl+K）。
 *
 * 一个入口干两件事：
 * - **搜**：书架、记事本、密码箱、分组、会话 —— 数据全在内存里，输入即出结果，不查库；
 * - **执行**：切换模块、打开某个工具、新建对话 —— 和搜索结果混在同一个列表里。
 *
 * 快捷键：⌘K / Ctrl+K 开关，↑↓ 选择，Enter 打开，Esc 关闭。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { JSX, KeyboardEvent as ReactKeyboardEvent } from 'react'

import { SEARCH_KIND_LABELS, searchAll } from '@shared/global-search'
import type { SearchSource } from '@shared/global-search'
import { useOverlayEscape } from '../../lib/use-overlay-dismiss'
import { useAppStore } from '../../stores/app-store'
import type { AppView, SearchTarget } from '../../stores/app-store'
import { TOOL_GROUPS } from '../tools/registry'

/** 面板里能执行的动作 */
type PaletteAction =
  | { type: 'view'; view: AppView }
  | { type: 'openBook'; bookId: string }
  | { type: 'openConversation'; conversationId: string }
  | { type: 'openTool'; toolId: string }
  | { type: 'openTarget'; target: SearchTarget }
  | { type: 'newConversation' }

interface PaletteSource extends SearchSource {
  action: PaletteAction
}

const VIEW_COMMANDS: Array<{ view: AppView; title: string }> = [
  { view: 'opencode', title: '切换到编程 Agent' },
  { view: 'agent-usage', title: '切换到 Token 统计' },
  { view: 'chat', title: '切换到对话' },
  { view: 'shelf', title: '切换到书架' },
  { view: 'stats', title: '切换到统计' },
  { view: 'passwords', title: '切换到密码箱' },
  { view: 'notes', title: '切换到记事本' },
  { view: 'tools', title: '切换到工具' },
  { view: 'settings', title: '切换到设置' }
]

function formatDate(ms: number): string {
  const date = new Date(ms)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate()
  ).padStart(2, '0')}`
}

export function CommandPalette(): JSX.Element | null {
  const settings = useAppStore((state) => state.settings)
  const conversations = useAppStore((state) => state.conversations)
  const books = useAppStore((state) => state.books)
  const groups = useAppStore((state) => state.groups)
  const notes = useAppStore((state) => state.notes)
  const passwords = useAppStore((state) => state.passwords)

  const setView = useAppStore((state) => state.setView)
  const openReader = useAppStore((state) => state.openReader)
  const selectConversation = useAppStore((state) => state.selectConversation)
  const createConversation = useAppStore((state) => state.createConversation)
  const setToolsActive = useAppStore((state) => state.setToolsActive)
  const openSearchTarget = useAppStore((state) => state.openSearchTarget)
  const clearSearchTarget = useAppStore((state) => state.clearSearchTarget)

  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const restoreFocus = useRef(true)

  useOverlayEscape(() => setOpen(false))

  // ⌘K / Ctrl+K 开关面板
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setOpen((current) => !current)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // 打开时聚焦输入框
  useEffect(() => {
    if (!open) return
    setQuery('')
    setActive(0)
    const previous = document.activeElement
    restoreFocus.current = true
    inputRef.current?.focus()
    return () => {
      if (restoreFocus.current && previous instanceof HTMLElement && previous.isConnected) {
        previous.focus()
      }
    }
  }, [open])

  /** 候选集合：命令 + 工具 + 本地数据 */
  const sources = useMemo<PaletteSource[]>(() => {
    const list: PaletteSource[] = []
    for (const command of VIEW_COMMANDS) {
      list.push({
        kind: 'command',
        id: `view-${command.view}`,
        title: command.title,
        action: { type: 'view', view: command.view }
      })
    }
    list.push({
      kind: 'command',
      id: 'new-conversation',
      title: '新建对话',
      action: { type: 'newConversation' }
    })
    for (const group of TOOL_GROUPS) {
      for (const tool of group.tools) {
        list.push({
          kind: 'tool',
          id: tool.id,
          title: tool.name,
          subtitle: group.name,
          action: { type: 'openTool', toolId: tool.id }
        })
      }
    }
    for (const book of books) {
      list.push({
        kind: 'book',
        id: book.id,
        title: book.title,
        subtitle: book.author || '未填作者',
        action: { type: 'openBook', bookId: book.id }
      })
    }
    for (const group of groups) {
      list.push({
        kind: 'group',
        id: group.id,
        title: group.name,
        action: { type: 'openTarget', target: { kind: 'group', id: group.id } }
      })
    }
    for (const note of notes) {
      list.push({
        kind: 'note',
        id: note.id,
        title: note.title || '未命名笔记',
        subtitle: formatDate(note.updatedAtMs),
        // 笔记正文参与匹配（但界面上只显示标题）
        keywords: note.content,
        action: { type: 'openTarget', target: { kind: 'note', id: note.id } }
      })
    }
    for (const entry of passwords) {
      // 全局搜索只索引标题与网址，不把账号、密码或备注加入候选集合。
      list.push({
        kind: 'password',
        id: entry.id,
        title: entry.title,
        subtitle: entry.url,
        action: { type: 'openTarget', target: { kind: 'password', id: entry.id } }
      })
    }
    for (const conversation of conversations) {
      list.push({
        kind: 'conversation',
        id: conversation.id,
        title: conversation.title,
        subtitle: `${conversation.messageCount} 条消息`,
        action: { type: 'openConversation', conversationId: conversation.id }
      })
    }
    if (settings?.activeId) {
      list.push({
        kind: 'command',
        id: 'active-profile',
        title: '查看当前 AI 配置',
        subtitle: settings.profiles.find((item) => item.id === settings.activeId)?.name ?? '',
        action: { type: 'view', view: 'settings' }
      })
    }
    return list
  }, [books, conversations, groups, notes, passwords, settings])

  const hits = useMemo(() => {
    const trimmed = query.trim()
    if (!trimmed) {
      // 没输入时只给命令与工具，别把几百本书糊在脸上
      return sources
        .filter((item) => item.kind === 'command' || item.kind === 'tool')
        .slice(0, 12)
    }
    return searchAll(trimmed, sources, 24)
  }, [query, sources])

  const activeIndex = Math.min(active, Math.max(0, hits.length - 1))
  useEffect(() => {
    if (!open) return
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [open, activeIndex, hits])

  const run = (action: PaletteAction): void => {
    if (
      useAppStore.getState().hasUnsavedChanges &&
      !window.confirm('当前有未保存的编辑，跳转将放弃这些内容。是否继续？')
    ) {
      return
    }
    // 导航后让目标页面接管焦点；只有取消面板才恢复原输入框的焦点。
    restoreFocus.current = false
    clearSearchTarget()
    const reportError = (error: unknown): void => {
      useAppStore.setState({ error: error instanceof Error ? error.message : '无法打开目标，请重试' })
    }
    switch (action.type) {
      case 'view':
        setView(action.view)
        break
      case 'openBook':
        openReader(action.bookId)
        break
      case 'openConversation':
        void selectConversation(action.conversationId).catch(reportError)
        setView('chat')
        break
      case 'openTool':
        setToolsActive(action.toolId)
        setView('tools')
        break
      case 'openTarget':
        openSearchTarget(action.target)
        break
      case 'newConversation':
        void createConversation().catch(reportError)
        setView('chat')
        break
    }
    setOpen(false)
  }

  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (event.nativeEvent.isComposing) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActive((current) => (hits.length === 0 ? 0 : (current + 1) % hits.length))
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((current) =>
        hits.length === 0 ? 0 : (current - 1 + hits.length) % hits.length
      )
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      const hit = hits[activeIndex]
      if (hit) run(hit.action)
    }
  }

  if (!open) return null

  return (
    <div
      className="palette-backdrop"
      role="presentation"
      onMouseDown={() => setOpen(false)}
    >
      <div
        className="palette-panel"
        role="dialog"
        aria-modal="true"
        aria-label="全局搜索"
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return
          if (event.key === 'Escape') {
            // 只关闭最上层命令面板，不让下层编辑弹层同时收到 Esc。
            event.preventDefault()
            event.stopPropagation()
            setOpen(false)
          }
          if (event.key === 'Tab') {
            event.preventDefault()
            inputRef.current?.focus()
          }
        }}
      >
        <input
          ref={inputRef}
          className="palette-input"
          type="text"
          value={query}
          placeholder="搜索书架 / 笔记 / 密码 / 会话，或输入命令…"
          role="combobox"
          aria-label="搜索内容或命令"
          aria-expanded="true"
          aria-autocomplete="list"
          aria-controls="palette-results"
          aria-activedescendant={hits.length > 0 ? `palette-hit-${activeIndex}` : undefined}
          spellCheck={false}
          onChange={(event) => {
            setQuery(event.target.value)
            setActive(0)
          }}
          onKeyDown={onKeyDown}
        />

        {hits.length === 0 ? (
          <p className="palette-empty" role="status">没有匹配项</p>
        ) : null}
        <ul
          className="palette-list"
          id="palette-results"
          role="listbox"
          aria-label="搜索结果"
          ref={listRef}
        >
          {hits.map((hit, index) => (
            <li key={`${hit.kind}-${hit.id}`} role="presentation">
              <button
                type="button"
                className={`palette-item${index === activeIndex ? ' active' : ''}`}
                role="option"
                id={`palette-hit-${index}`}
                aria-selected={index === activeIndex}
                tabIndex={-1}
                onMouseEnter={() => setActive(index)}
                onClick={() => run(hit.action)}
              >
                <span className="palette-item-kind">{SEARCH_KIND_LABELS[hit.kind]}</span>
                <span className="palette-item-title">{hit.title}</span>
                {hit.subtitle ? (
                  <span className="palette-item-sub">{hit.subtitle}</span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>

        <footer className="palette-footer">
          <span>↑↓ 选择</span>
          <span>Enter 打开</span>
          <span>Esc 关闭</span>
          <span className="palette-footer-tip">⌘K / Ctrl+K 随时唤起</span>
        </footer>
      </div>
    </div>
  )
}
