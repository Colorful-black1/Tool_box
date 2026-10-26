import { useState } from 'react'
import type { JSX } from 'react'
import { useCodingAgentStore } from '../../stores/coding-agent-store'
import { PlusIcon, RefreshIcon } from '../icons'

export const OPENCODE_STATUS = {
  ready: '就绪',
  running: '执行中',
  stopping: '停止中',
  disconnected: '已断开',
  error: '任务失败'
}

/** 原生历史与已打开会话共用一份列表，只有明确打开历史时才连接读取。 */
export function OpenCodeSessions(): JSX.Element {
  const info = useCodingAgentStore((state) => state.info)
  const runtimeId = useCodingAgentStore((state) => state.runtimeId)
  const directory = useCodingAgentStore((state) => state.directory)
  const sessions = useCodingAgentStore((state) => state.sessions)
  const activeId = useCodingAgentStore((state) => state.activeId)
  const history = useCodingAgentStore((state) => state.history)
  const historyLoaded = useCodingAgentStore((state) => state.historyLoaded)
  const busy = useCodingAgentStore((state) => state.busy)
  const runningRuntime = useCodingAgentStore((state) => state.runningRuntime)
  const newSession = useCodingAgentStore((state) => state.newSession)
  const openSession = useCodingAgentStore((state) => state.openSession)
  const listSessions = useCodingAgentStore((state) => state.listSessions)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [query, setQuery] = useState('')
  const local = Object.values(sessions).filter(
    (item) => item.connectionId === info?.connectionId && item.directory === directory
  )
  const items = new Map(
    (historyOpen ? history : []).map((item) => [item.id, { ...item, ref: '', status: '历史' }])
  )
  for (const item of local)
    items.set(item.nativeSessionId, {
      id: item.nativeSessionId,
      title: item.title,
      ref: item.id,
      status: OPENCODE_STATUS[item.status]
    })
  const visible = [...items.values()].filter((item) =>
    item.title.toLowerCase().includes(query.trim().toLowerCase())
  )
  return (
    <aside className="glass opencode-sessions" aria-label="编程会话列表">
      <div className="opencode-sessions-head">
        <h2 className="chat-title">项目会话</h2>
        {historyOpen ? (
          <button
            type="button"
            className="icon-btn"
            aria-label="刷新历史会话"
            disabled={busy || !!runningRuntime}
            onClick={() => void listSessions()}
          >
            <RefreshIcon />
          </button>
        ) : (
          <span>{items.size}</span>
        )}
      </div>
      <button type="button" className="btn-ghost" disabled={busy} onClick={newSession}>
        <PlusIcon />
        新对话
      </button>
      <button
        type="button"
        className="btn-ghost"
        aria-expanded={historyOpen}
        disabled={!directory || busy || !!runningRuntime}
        onClick={() => {
          setHistoryOpen(!historyOpen)
          // 外部 Agent 可能在列表收起期间新增会话，展开时不能只沿用旧缓存。
          if (!historyOpen) void listSessions()
        }}
      >
        历史会话
      </button>
      {runtimeId === 'claude-desktop' && historyOpen && historyLoaded ? (
        <p className="opencode-session-empty">
          只列当前项目的 Code 历史。找不到时，请切换到 Desktop 使用的项目目录，再刷新历史。
          普通 Chat 不在此列。
        </p>
      ) : null}
      {items.size > 6 ? (
        <input
          className="field-input"
          aria-label="搜索会话"
          placeholder="搜索会话"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      ) : null}
      <div className="opencode-session-list" aria-busy={busy}>
        {!visible.length ? (
          <p className="opencode-session-empty">
            {busy
              ? '正在读取…'
              : query
                ? '没有匹配的会话'
                : historyOpen && historyLoaded
                  ? '当前项目暂无会话。'
                  : '直接输入任务开始，或打开历史会话。'}
          </p>
        ) : null}
        {visible.map((item) => (
          <button
            type="button"
            key={item.id}
            className={`btn-ghost opencode-session-item${item.ref && item.ref === activeId ? ' active' : ''}`}
            disabled={busy || (!item.ref && (!!runningRuntime || !info?.canLoadSession))}
            onClick={() => void openSession(item.id)}
            aria-current={item.ref === activeId ? 'page' : undefined}
          >
            <span className="opencode-session-title" title={item.title}>
              {item.title}
            </span>
            <small className="opencode-session-state">{item.status}</small>
          </button>
        ))}
      </div>
    </aside>
  )
}
