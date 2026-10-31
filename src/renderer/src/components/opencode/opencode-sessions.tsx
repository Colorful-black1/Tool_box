import { useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import { useCodingAgentStore } from '../../stores/coding-agent-store'
import { CloseIcon, PlusIcon, RefreshIcon, SearchIcon } from '../icons'
import { Popover } from '../popover'

export const OPENCODE_STATUS = {
  ready: '就绪',
  running: '执行中',
  stopping: '停止中',
  disconnected: '已断开',
  error: '任务失败'
}

/** 原生历史与已打开会话共用一份列表，只有明确打开历史时才连接读取。 */
export function OpenCodeSessions({
  showHistory = 0,
  onHistoryShown
}: {
  showHistory?: number
  onHistoryShown?(): void
}): JSX.Element {
  const info = useCodingAgentStore((state) => state.info)
  const runtimeId = useCodingAgentStore((state) => state.runtimeId)
  const directory = useCodingAgentStore((state) => state.directory)
  const sessions = useCodingAgentStore((state) => state.sessions)
  const closedSessions = useCodingAgentStore((state) => state.closedSessions)
  const activeId = useCodingAgentStore((state) => state.activeId)
  const history = useCodingAgentStore((state) => state.history)
  const historyLoaded = useCodingAgentStore((state) => state.historyLoaded)
  const busy = useCodingAgentStore((state) => state.busy)
  const running = useCodingAgentStore((state) => Boolean(state.runs[state.runtimeId]))
  const preparing = useCodingAgentStore((state) => state.preparations[state.runtimeId])
  const newSession = useCodingAgentStore((state) => state.newSession)
  const openSession = useCodingAgentStore((state) => state.openSession)
  const listSessions = useCodingAgentStore((state) => state.listSessions)
  const selectSession = useCodingAgentStore((state) => state.selectSession)
  const closeSession = useCodingAgentStore((state) => state.closeSession)
  const runningRef = useCodingAgentStore((state) => state.runs[state.runtimeId]?.sessionId)
  const historyAnchor = useRef<HTMLButtonElement>(null)
  const search = useRef<HTMLInputElement>(null)
  const tabs = useRef<HTMLDivElement>(null)
  const focusAfterClose = useRef(false)
  const closeTab = (id: string): void => {
    focusAfterClose.current = closeSession(id)
  }
  const [historyOpen, setHistoryOpen] = useState(false)
  const [query, setQuery] = useState('')
  const lastHistoryConnection = useRef('')
  useEffect(() => {
    // 重连会换 connectionId 并清空缓存历史；历史面板已打开时自动补读一次。
    if (!historyOpen || !info?.connected || historyLoaded || busy || running || preparing) return
    if (lastHistoryConnection.current === info.connectionId) return
    lastHistoryConnection.current = info.connectionId
    void listSessions()
  }, [
    historyOpen,
    info?.connected,
    info?.connectionId,
    historyLoaded,
    busy,
    running,
    preparing,
    listSessions
  ])
  useEffect(() => {
    if (showHistory) {
      setHistoryOpen(true)
      onHistoryShown?.()
      void listSessions()
    }
  }, [showHistory, listSessions, onHistoryShown])
  useEffect(() => {
    const refresh = (): void => {
      if (
        (runtimeId === 'claude' || runtimeId === 'claude-desktop') &&
        info?.connected &&
        historyLoaded &&
        !busy &&
        !running &&
        !preparing
      )
        void listSessions()
    }
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  }, [
    runtimeId,
    info?.connected,
    historyOpen,
    historyLoaded,
    busy,
    running,
    preparing,
    listSessions
  ])
  const cached = Object.values(sessions).filter(
    (item) =>
      (item.connectionId === info?.connectionId || item.status === 'disconnected') &&
      item.directory === directory
  )
  const local = cached.filter((item) => !closedSessions.includes(item.id))
  const items = new Map(
    (historyOpen ? history : []).map((item) => [item.id, { ...item, ref: '', status: '历史' }])
  )
  for (const item of cached)
    items.set(item.nativeSessionId, {
      id: item.nativeSessionId,
      title: item.title,
      ref: item.id,
      status: OPENCODE_STATUS[item.status]
    })
  const visible = [...items.values()].filter((item) =>
    item.title.toLowerCase().includes(query.trim().toLowerCase())
  )
  // 未打开的历史条目在执行中 / 未连接 / 不支持恢复时是禁用的。
  // 按钮禁用后没有任何反馈，用户只会以为点了没反应，这里直接说明原因。
  const historyBlocked = visible.some((item) => !item.ref && (running || !info?.canLoadSession))
  const historyNotice = !historyBlocked
    ? ''
    : running
      ? '任务执行中，结束后才能切换会话。'
      : !info?.connected
        ? 'Agent 未连接，连接后才能打开历史会话。'
        : '当前 Agent 不支持在应用内恢复历史会话，请在其原生界面打开。'
  useEffect(() => {
    const selected = tabs.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]')
    selected?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    if (focusAfterClose.current) {
      focusAfterClose.current = false
      selected?.focus()
    }
  }, [activeId, local.length])
  return (
    <nav className="opencode-sessions" aria-label="编程会话列表">
      <div
        className="agent-session-tabs"
        role="tablist"
        aria-label="已打开会话"
        ref={tabs}
        onKeyDown={(event) => {
          if ((event.target as HTMLElement).getAttribute('role') !== 'tab') return
          const elements = [
            ...(tabs.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]:not(:disabled)') ??
              [])
          ]
          const index = elements.findIndex((item) => item === document.activeElement)
          const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
          if (step) {
            event.preventDefault()
            elements[(index + step + elements.length) % elements.length]?.focus()
          } else if (event.key === 'Home' || event.key === 'End') {
            event.preventDefault()
            elements[event.key === 'Home' ? 0 : elements.length - 1]?.focus()
          }
        }}
      >
        {local.map((item) => (
          <div className="agent-session-tab-wrap" role="presentation" key={item.id}>
            <button
              type="button"
              role="tab"
              className={`btn-ghost agent-session-tab${item.id === activeId ? ' active' : ''}`}
              aria-selected={item.id === activeId}
              aria-controls="agent-session-panel"
              tabIndex={item.id === activeId ? 0 : -1}
              disabled={busy}
              title={`${item.title} · ${OPENCODE_STATUS[item.status]}`}
              onClick={() =>
                void (item.status === 'disconnected'
                  ? openSession(item.nativeSessionId)
                  : selectSession(item.id))
              }
              onKeyDown={(event) => {
                if (event.key === 'Delete') {
                  event.preventDefault()
                  closeTab(item.id)
                }
              }}
            >
              <span className="agent-tab-dot" data-status={item.status} aria-hidden="true" />
              <span className="opencode-session-title">{item.title}</span>
            </button>
            <button
              type="button"
              className="icon-btn agent-session-close"
              aria-label={`关闭会话：${item.title}`}
              title={
                item.status === 'running' || item.status === 'stopping' || runningRef === item.id
                  ? '先停止任务再关闭'
                  : '关闭会话'
              }
              disabled={
                busy ||
                Boolean(preparing) ||
                item.status === 'running' ||
                item.status === 'stopping' ||
                runningRef === item.id
              }
              onClick={() => closeTab(item.id)}
            >
              <CloseIcon />
            </button>
          </div>
        ))}
        {!activeId ? (
          <button
            type="button"
            role="tab"
            className="btn-ghost agent-session-tab active"
            aria-selected="true"
            aria-controls="agent-session-panel"
          >
            新对话
          </button>
        ) : null}
      </div>
      <button
        type="button"
        className="icon-btn"
        aria-label="新对话"
        title="新对话"
        disabled={busy}
        onClick={() => {
          if (activeId) newSession()
          document.querySelector<HTMLTextAreaElement>('#opencode-draft')?.focus()
        }}
      >
        <PlusIcon />
      </button>
      <button
        type="button"
        className="icon-btn"
        ref={historyAnchor}
        aria-label="历史会话"
        title="历史会话"
        aria-expanded={historyOpen}
        aria-haspopup="dialog"
        disabled={!directory || busy || running || Boolean(preparing)}
        onClick={() => {
          setHistoryOpen(!historyOpen)
          if (!historyOpen) void listSessions()
        }}
      >
        <SearchIcon />
      </button>
      {historyOpen ? (
        <Popover
          anchor={historyAnchor}
          align="right"
          matchAnchorWidth={false}
          className="agent-history-popover"
          onClose={() => setHistoryOpen(false)}
          onReady={() => search.current?.focus()}
        >
          <section role="dialog" aria-label="历史会话">
            <div className="agent-history-head">
              <h3>历史会话</h3>
              <button
                type="button"
                className="icon-btn"
                aria-label="刷新历史会话"
                title="刷新历史会话"
                disabled={busy || running || Boolean(preparing)}
                onClick={() => void listSessions()}
              >
                <RefreshIcon />
              </button>
            </div>
            <div className="opencode-session-search">
              <SearchIcon />
              <input
                ref={search}
                className="field-input"
                aria-label="搜索会话"
                placeholder="搜索会话"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            {historyNotice ? <p className="field-hint">{historyNotice}</p> : null}
            <div className="opencode-session-list" id="opencode-session-list" aria-busy={busy}>
              {!visible.length ? (
                <p className="opencode-session-empty">
                  {busy ? '正在读取…' : query ? '无匹配会话' : '暂无会话'}
                </p>
              ) : null}
              {visible.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  className={`btn-ghost opencode-session-item${item.ref && item.ref === activeId ? ' active' : ''}`}
                  disabled={busy || (!item.ref && (running || !info?.canLoadSession))}
                  onClick={async () => {
                    await openSession(item.id)
                    setHistoryOpen(false)
                  }}
                  aria-current={item.ref && item.ref === activeId ? 'page' : undefined}
                >
                  <span className="opencode-session-title" title={item.title}>
                    {item.title}
                  </span>
                  <small className="opencode-session-state">{item.status}</small>
                </button>
              ))}
            </div>
          </section>
        </Popover>
      ) : null}
    </nav>
  )
}
