import { useEffect, useState } from 'react'
import type { JSX } from 'react'
import { useCodingAgentStore } from '../../stores/coding-agent-store'
import { CODING_AGENT_NAMES } from '@shared/coding-agents'
import { Dropdown } from '../dropdown'
import { OpenCodeConnection } from './opencode-connection'
import { OpenCodeMessages } from './opencode-messages'
import { AgentComposer } from './agent-composer'
import { OpenCodeSessions, OPENCODE_STATUS } from './opencode-sessions'
import { OpenCodeActivity } from './opencode-activity'
import { AgentDraftRecovery } from './agent-draft-recovery'
import { OpenCodeMoreMenu } from './opencode-more-menu'
import { AgentRunningTasks } from './agent-running-tasks'
import { AgentHandoffNotice } from './agent-handoff-notice'
import { AgentRunRecovery } from './agent-run-recovery'

/** 发送是唯一的任务入口，连接和空白会话按需要准备。 */
export function OpenCodeWorkbench(): JSX.Element {
  const info = useCodingAgentStore((state) => state.info)
  const runtimeId = useCodingAgentStore((state) => state.runtimeId)
  const directory = useCodingAgentStore((state) => state.directory)
  const running = useCodingAgentStore((state) => Boolean(state.runs[state.runtimeId]))
  const preparing = useCodingAgentStore((state) => state.preparations[state.runtimeId])
  const sessions = useCodingAgentStore((state) => state.sessions)
  const activeId = useCodingAgentStore((state) => state.activeId)
  const draft = useCodingAgentStore((state) => state.draft)
  const transferred = useCodingAgentStore((state) => state.transferred)
  const history = useCodingAgentStore((state) => state.history)
  const busy = useCodingAgentStore((state) => state.busy)
  const error = useCodingAgentStore((state) => state.error)
  const inspect = useCodingAgentStore((state) => state.inspect)
  const summarize = useCodingAgentStore((state) => state.summarize)
  const listSessions = useCodingAgentStore((state) => state.listSessions)
  const attachWorkspace = useCodingAgentStore((state) => state.attachWorkspace)
  const openSession = useCodingAgentStore((state) => state.openSession)
  const clearError = useCodingAgentStore((state) => state.clearError)
  const [showHistory, setShowHistory] = useState(0)
  const [workspaceStatus, setWorkspaceStatus] = useState('')
  const name = CODING_AGENT_NAMES[runtimeId]
  const session = activeId ? sessions[activeId] : undefined
  const visibleModels = new Set(info?.visibleModelIds ?? [])
  const model = session?.options.find((option) => option.category === 'model')
  const modelNeedsSelection = Boolean(model && !visibleModels.has(model.currentValue))
  const permission = session?.options.find((option) => option.category === 'permission')
  const permissionNeedsSelection = Boolean(
    runtimeId === 'codex' &&
    permission &&
    !permission.options.some((item) => item.value === permission.currentValue)
  )
  const locked = Boolean(running || preparing)
  const canSend = Boolean(
    directory &&
    info?.available &&
    info.executablePath &&
    !modelNeedsSelection &&
    !permissionNeedsSelection &&
    !locked &&
    !busy &&
    draft.trim() &&
    draft.length <= 50_000
  )
  const targetSessions = new Map(history.map((item) => [item.id, item.title]))
  for (const item of Object.values(sessions)) {
    if (item.connectionId === info?.connectionId && item.directory === directory)
      targetSessions.set(item.nativeSessionId, item.title)
  }
  useEffect(() => {
    void inspect()
  }, [inspect, runtimeId])
  useEffect(() => {
    setWorkspaceStatus('')
  }, [activeId, runtimeId])

  return (
    <div className="opencode-page view-enter">
      <OpenCodeConnection />
      {error ? (
        <div className="status-banner" role="alert">
          <span>{error}</span>
          <button type="button" className="btn-ghost" onClick={clearError}>
            关闭提示
          </button>
        </div>
      ) : null}
      <AgentRunningTasks />
      <AgentHandoffNotice />
      <div className="opencode-layout">
        <div className="agent-session-bar">
          <OpenCodeSessions
            key={`${runtimeId}:${directory}`}
            showHistory={showHistory}
            onHistoryShown={() => setShowHistory(0)}
          />
          <OpenCodeMoreMenu
            canSummarize={Boolean(
              session && !busy && !locked && info?.connected && !permissionNeedsSelection
            )}
            canSync={!busy && !locked}
            canAttachWorkspace={Boolean(session && info?.connected && !busy && !locked)}
            onSummarize={() => void summarize()}
            onSync={() => void inspect(true)}
            onAttachWorkspace={
              runtimeId === 'dsh'
                ? () => {
                    void attachWorkspace().then((message) => {
                      if (message) setWorkspaceStatus(message)
                    })
                  }
                : undefined
            }
          />
          <span className="chat-status opencode-session-state" data-status={session?.status}>
            {session?.questions?.length
              ? '等待回答'
              : session
                ? OPENCODE_STATUS[session.status]
                : '等待输入'}
          </span>
        </div>
        <section
          className="glass chat-panel opencode-panel"
          id="agent-session-panel"
          role="tabpanel"
          aria-label={`${name} 工作台`}
        >
          <h2 className="sr-only">{session?.title ?? '新对话'}</h2>
          {runtimeId === 'dsh' && workspaceStatus ? (
            <p className="status-banner success-banner" role="status">
              {workspaceStatus}
            </p>
          ) : null}
          {session || !transferred ? (
            <OpenCodeMessages session={session} agentName={name} />
          ) : (
            <div className="opencode-transfer-space" />
          )}
          <OpenCodeActivity session={session} agentName={name} />
          {session?.error ? (
            <div className="status-banner" role="alert">
              {session.error}
            </div>
          ) : null}
          <AgentRunRecovery session={session} />
          <AgentComposer
            key={`${runtimeId}:${directory}`}
            canSend={canSend}
            onLocalAction={(action) => {
              if (action === 'history') setShowHistory((old) => old + 1)
              else {
                requestAnimationFrame(() =>
                  document
                    .querySelector<HTMLButtonElement>(
                      action === 'model'
                        ? '.agent-composer-options [aria-label*="模型"]'
                        : '.agent-composer-options [aria-label*="权限"], .agent-composer-options [aria-label*="模式"]'
                    )
                    ?.click()
                )
              }
            }}
          >
            {modelNeedsSelection ? (
              <p className="status-banner" role="status">
                模型不可用，请重新选择或同步模型。
              </p>
            ) : null}
            {permissionNeedsSelection ? (
              <p className="status-banner" role="status">
                请选择操作权限后继续。
              </p>
            ) : null}
            {transferred ? (
              <details
                className="opencode-transfer-target"
                onToggle={(event) => {
                  if (event.currentTarget.open && !busy) void listSessions()
                }}
              >
                <summary>已转入当前项目草稿 · 改用已有会话</summary>
                <Dropdown
                  ariaLabel="改用已有会话"
                  value=""
                  placeholder="选择目标会话"
                  options={[...targetSessions].map(([value, label]) => ({ value, label }))}
                  onChange={(id) => void openSession(id, true)}
                  disabled={busy || locked}
                  searchable
                  align="left"
                />
              </details>
            ) : null}
          </AgentComposer>
          <AgentDraftRecovery />
        </section>
      </div>
    </div>
  )
}
