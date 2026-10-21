import type { JSX } from 'react'
import { useOpenCodeStore } from '../../stores/opencode-store'
import { Dropdown } from '../dropdown'
import { PlusIcon, RefreshIcon } from '../icons'

export const OPENCODE_STATUS = {
  ready: '就绪',
  running: '执行中',
  stopping: '停止中',
  disconnected: '已断开',
  error: '任务失败'
}

export function OpenCodeSessions({ running }: { running: boolean }): JSX.Element {
  const info = useOpenCodeStore((state) => state.info)
  const sessions = useOpenCodeStore((state) => state.sessions)
  const activeId = useOpenCodeStore((state) => state.activeId)
  const history = useOpenCodeStore((state) => state.history)
  const busy = useOpenCodeStore((state) => state.busy)
  const openSession = useOpenCodeStore((state) => state.openSession)
  const listSessions = useOpenCodeStore((state) => state.listSessions)
  const selectSession = useOpenCodeStore((state) => state.selectSession)
  return (
    <aside className="glass opencode-sessions" aria-label="编程会话列表">
      <div className="opencode-sessions-head">
        <h2 className="chat-title">项目会话</h2>
        <span>{Object.keys(sessions).length}</span>
      </div>
      <button
        type="button"
        className="btn-ghost"
        disabled={!info?.connected || busy || running}
        onClick={() => void openSession()}
      >
        <PlusIcon />
        新建编程会话
      </button>
      <button
        type="button"
        className="btn-ghost"
        disabled={!info?.connected || busy || running}
        onClick={() => void listSessions()}
      >
        <RefreshIcon />
        读取 OpenCode 历史
      </button>
      {history.length ? (
        <Dropdown
          ariaLabel="恢复编程会话"
          value=""
          placeholder="选择历史会话"
          options={history.map((item) => ({ value: item.id, label: item.title }))}
          onChange={(id) => void openSession(id)}
          disabled={busy || running || !info?.canLoadSession}
          searchable
          align="left"
        />
      ) : null}
      <div className="opencode-session-list">
        {!Object.keys(sessions).length ? (
          <p className="opencode-session-empty">连接项目后，在这里管理编程会话。</p>
        ) : null}
        {Object.values(sessions).map((item) => (
          <button
            type="button"
            className={`btn-ghost opencode-session-item${item.id === activeId ? ' active' : ''}`}
            key={item.id}
            onClick={() => selectSession(item.id)}
            aria-current={item.id === activeId ? 'page' : undefined}
          >
            <span className="opencode-session-title" title={item.title}>
              {item.title}
            </span>
            <small className="opencode-session-state" data-status={item.status}>
              {OPENCODE_STATUS[item.status]}
            </small>
          </button>
        ))}
      </div>
      <p className="field-hint">原生记录由 OpenCode 保存。读取历史仅列出所选项目的会话。</p>
    </aside>
  )
}
