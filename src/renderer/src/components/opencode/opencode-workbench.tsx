import { useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import { useCodingAgentStore } from '../../stores/coding-agent-store'
import { CODING_AGENT_NAMES } from '@shared/coding-agents'
import { Dropdown } from '../dropdown'
import { OpenCodeConnection } from './opencode-connection'
import { OpenCodeMessages } from './opencode-messages'
import { SendIcon, StopIcon } from '../icons'
import { OpenCodeSessions, OPENCODE_STATUS } from './opencode-sessions'
import { OpenCodeActivity } from './opencode-activity'
import { AgentDraftRecovery } from './agent-draft-recovery'
import { useOverlayEscape } from '../../lib/use-overlay-dismiss'

const OPTION_NAMES: Record<string, string> = {
  model: '模型',
  mode: '工作模式',
  thought_level: '思考强度'
}

/** 发送是唯一的任务入口，连接和空白会话按需要准备。 */
export function OpenCodeWorkbench(): JSX.Element {
  const info = useCodingAgentStore((state) => state.info)
  const runtimeId = useCodingAgentStore((state) => state.runtimeId)
  const directory = useCodingAgentStore((state) => state.directory)
  const runningRuntime = useCodingAgentStore((state) => state.runningRuntime)
  const runningSession = useCodingAgentStore((state) => state.runningSession)
  const preparingRuntime = useCodingAgentStore((state) => state.preparingRuntime)
  const sessions = useCodingAgentStore((state) => state.sessions)
  const activeId = useCodingAgentStore((state) => state.activeId)
  const draft = useCodingAgentStore((state) => state.draft)
  const transferred = useCodingAgentStore((state) => state.transferred)
  const history = useCodingAgentStore((state) => state.history)
  const busy = useCodingAgentStore((state) => state.busy)
  const error = useCodingAgentStore((state) => state.error)
  const inspect = useCodingAgentStore((state) => state.inspect)
  const setOption = useCodingAgentStore((state) => state.setOption)
  const setDraft = useCodingAgentStore((state) => state.setDraft)
  const send = useCodingAgentStore((state) => state.send)
  const summarize = useCodingAgentStore((state) => state.summarize)
  const stop = useCodingAgentStore((state) => state.stop)
  const viewRunning = useCodingAgentStore((state) => state.viewRunning)
  const cancelPreparation = useCodingAgentStore((state) => state.cancelPreparation)
  const listSessions = useCodingAgentStore((state) => state.listSessions)
  const openSession = useCodingAgentStore((state) => state.openSession)
  const clearError = useCodingAgentStore((state) => state.clearError)
  const [advanced, setAdvanced] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const menu = useRef<HTMLDetailsElement>(null)
  const closeMenu = (): void => {
    setMenuOpen(false)
    menu.current?.querySelector('summary')?.focus()
  }
  useOverlayEscape(closeMenu, menuOpen)
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
  const locked = Boolean(runningRuntime || preparingRuntime)
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
    const outside = (event: MouseEvent): void => {
      if (event.target instanceof Node && !menu.current?.contains(event.target))
        setMenuOpen(false)
    }
    document.addEventListener('mousedown', outside)
    return () => document.removeEventListener('mousedown', outside)
  }, [])

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
      {runningRuntime && (runningRuntime !== runtimeId || runningSession !== activeId) ? (
        <div className="status-banner" role="status">
          <span>{CODING_AGENT_NAMES[runningRuntime]} 正在执行任务。</span>
          <button type="button" className="btn-ghost" onClick={viewRunning}>
            查看运行任务
          </button>
          <button type="button" className="btn-ghost" onClick={() => void stop()}>
            停止任务
          </button>
        </div>
      ) : null}
      <div className="opencode-layout">
        <OpenCodeSessions key={`${runtimeId}:${directory}`} />
        <section className="glass chat-panel opencode-panel" aria-label={`${name} 工作台`}>
          <header className="chat-head">
            <h2 className="chat-title">{session?.title ?? '新对话'}</h2>
            <details
              className="opencode-more"
              ref={menu}
              open={menuOpen}
            >
              <summary
                aria-expanded={menuOpen}
                onClick={(event) => {
                  event.preventDefault()
                  setMenuOpen(!menuOpen)
                }}
              >
                更多
              </summary>
              <div className="opencode-more-menu">
                <button
                  type="button"
                  className="btn-ghost"
                  disabled={
                    !session || busy || locked || !info?.connected || permissionNeedsSelection
                  }
                  onClick={() => {
                    closeMenu()
                    void summarize()
                  }}
                >
                  生成交接说明
                </button>
                <button
                  type="button"
                  className="btn-ghost"
                  disabled={busy || locked}
                  onClick={() => {
                    closeMenu()
                    void inspect(true)
                  }}
                >
                  同步模型
                </button>
                <button
                  type="button"
                  className="btn-ghost"
                  aria-expanded={advanced}
                  onClick={() => {
                    closeMenu()
                    setAdvanced(!advanced)
                  }}
                >
                  更多模型设置
                </button>
              </div>
            </details>
            <span className="chat-status opencode-session-state" data-status={session?.status}>
              {session ? OPENCODE_STATUS[session.status] : '等待输入'}
            </span>
          </header>
          {session ? (
            <div className="opencode-options">
              {session.options
                .filter(
                  (option) => advanced || ['model', 'mode', 'permission'].includes(option.category)
                )
                .map((option) => (
                  <div className="opencode-option" key={option.id}>
                    <span className="field-label">
                      {OPTION_NAMES[option.category] ?? option.name}
                    </span>
                    <Dropdown
                      ariaLabel={`${name} ${OPTION_NAMES[option.category] ?? option.name}`}
                      value={option.currentValue}
                      options={
                        option.category === 'model'
                          ? option.options.filter((item) => visibleModels.has(item.value))
                          : option.options
                      }
                      placeholder="请选择"
                      onChange={(value) => void setOption(option.id, value)}
                      disabled={busy || locked || !info?.connected}
                      searchable={option.options.length > 8}
                      align="left"
                    />
                  </div>
                ))}
              {modelNeedsSelection ? (
                <span className="field-hint" role="status">
                  当前模型不可用，请选择已启用模型，或在更多菜单同步模型。
                </span>
              ) : null}
              {permissionNeedsSelection ? (
                <span className="field-hint" role="status">
                  历史已打开。原会话权限无法直接沿用，请先选择只读或项目写入后继续。
                </span>
              ) : null}
            </div>
          ) : (
            <p className="field-hint opencode-start-hint">
              首次发送会连接并新建会话。
              {runtimeId === 'opencode'
                ? '新会话使用 Plan 模式。'
                : runtimeId === 'claude' || runtimeId === 'claude-desktop'
                  ? '新会话使用计划模式；标准模式中的操作遵循原生规则与审批。'
                  : runtimeId === 'dsh'
                    ? '操作权限沿用 DSH 原生规则，需要审批时在此确认。'
                    : '新会话使用只读权限。'}
              模型沿用原生默认；不可用时会停下供你选择。
            </p>
          )}
          {runtimeId === 'dsh' ? (
            <p className="status-banner">
              回复提交后更新，无实时 Token 分片；可续接上下文，暂不回放旧消息。历史属于独立 acp
              profile。
            </p>
          ) : null}
          {runtimeId === 'claude-desktop' ? (
            <p className="status-banner opencode-desktop-hint">
              沿用 Desktop 的第三方供应商配置；历史只列当前项目已结束的 Desktop Code 会话，不含普通
              Chat。工具箱新建的会话不会自动出现在 Desktop。
              续接原会话前需完整退出外部 Claude 程序；本地网关需保持 CC Switch 运行。
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
          <form
            className={`composer${transferred ? ' opencode-transferred' : ''}`}
            onSubmit={(event) => {
              event.preventDefault()
              if (canSend) void send()
            }}
          >
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
            <label className="sr-only" htmlFor="opencode-draft">
              编程任务草稿
            </label>
            <div className="composer-box">
              <textarea
                id="opencode-draft"
                className="composer-input"
                rows={3}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="描述任务，点击发送开始；也可从 Prompt 或工具结果填入内容"
              />
              <div className="composer-actions">
                <span className="field-hint">只恢复输入，不自动发送</span>
                <span className="opencode-draft-count">{draft.length.toLocaleString()}/50,000</span>
                {preparingRuntime ? (
                  <button type="button" className="btn-ghost" onClick={cancelPreparation}>
                    取消准备
                  </button>
                ) : runningRuntime === runtimeId && runningSession === activeId ? (
                  <button
                    type="button"
                    className="btn-ghost"
                    disabled={session?.status !== 'running'}
                    onClick={() => void stop()}
                  >
                    <StopIcon />
                    停止任务
                  </button>
                ) : (
                  <button type="submit" className="btn-gold" disabled={!canSend}>
                    <SendIcon />
                    {busy ? '准备中…' : session ? `发送给 ${name}` : `开始对话 · ${name}`}
                  </button>
                )}
              </div>
            </div>
          </form>
          <AgentDraftRecovery />
        </section>
      </div>
    </div>
  )
}
