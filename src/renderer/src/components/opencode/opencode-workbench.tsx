import { useEffect } from 'react'
import type { JSX } from 'react'
import { useOpenCodeStore } from '../../stores/opencode-store'
import { Dropdown } from '../dropdown'
import { OpenCodeConnection } from './opencode-connection'
import { OpenCodeMessages } from './opencode-messages'
import { RefreshIcon, SendIcon, StopIcon } from '../icons'
import { OpenCodeSessions, OPENCODE_STATUS } from './opencode-sessions'
import { OpenCodeActivity } from './opencode-activity'

const OPTION_NAMES: Record<string, string> = {
  model: '模型',
  mode: '工作模式',
  thought_level: '思考强度'
}

export function OpenCodeWorkbench(): JSX.Element {
  const info = useOpenCodeStore((state) => state.info)
  const sessions = useOpenCodeStore((state) => state.sessions)
  const activeId = useOpenCodeStore((state) => state.activeId)
  const draft = useOpenCodeStore((state) => state.draft)
  const busy = useOpenCodeStore((state) => state.busy)
  const error = useOpenCodeStore((state) => state.error)
  const inspect = useOpenCodeStore((state) => state.inspect)
  const setOption = useOpenCodeStore((state) => state.setOption)
  const setDraft = useOpenCodeStore((state) => state.setDraft)
  const send = useOpenCodeStore((state) => state.send)
  const stop = useOpenCodeStore((state) => state.stop)
  const clearError = useOpenCodeStore((state) => state.clearError)
  const session = activeId ? sessions[activeId] : undefined
  const visibleModels = new Set(info?.visibleModelIds ?? [])
  const model = session?.options.find((option) => option.category === 'model')
  const modelNeedsSelection = Boolean(model && !visibleModels.has(model.currentValue))
  const running = Object.values(sessions).some(
    (item) => item.status === 'running' || item.status === 'stopping'
  )
  const canSend = Boolean(
    info?.connected &&
    session &&
    !modelNeedsSelection &&
    !running &&
    !busy &&
    draft.trim() &&
    draft.length <= 50_000
  )
  useEffect(() => {
    void inspect()
  }, [inspect])

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
      <div className="opencode-layout">
        <OpenCodeSessions running={running} />
        <section className="glass chat-panel opencode-panel" aria-label="OpenCode 工作台">
          <header className="chat-head">
            <h2 className="chat-title">{session?.title ?? '编程工作台'}</h2>
            <span
              className="chat-status opencode-session-state"
              data-status={session?.status}
              role="status"
            >
              {session
                ? OPENCODE_STATUS[session.status]
                : info?.connected
                  ? '请选择会话'
                  : '等待连接'}
            </span>
          </header>
          {session ? (
            <div className="opencode-options">
              {session.options.map((option) => {
                const options =
                  option.category === 'model'
                    ? option.options.filter((item) => visibleModels.has(item.value))
                    : option.options
                return (
                  <div className="opencode-option" key={option.id}>
                    <span className="field-label">
                      {Object.hasOwn(OPTION_NAMES, option.category)
                        ? OPTION_NAMES[option.category]
                        : option.name}
                    </span>
                    <Dropdown
                      ariaLabel={`OpenCode ${Object.hasOwn(OPTION_NAMES, option.category) ? OPTION_NAMES[option.category] : option.name}`}
                      value={option.currentValue}
                      options={options}
                      placeholder={option.category === 'model' ? '选择已启用模型' : '请选择'}
                      onChange={(value) => void setOption(option.id, value)}
                      disabled={busy || running || !info?.connected}
                      searchable={options.length > 8}
                      align="left"
                    />
                  </div>
                )
              })}
              <button
                type="button"
                className="btn-ghost"
                disabled={busy || running || !info?.connected}
                onClick={() => void inspect(true)}
                title="在 OpenCode Desktop 更改模型勾选后，点击同步"
              >
                <RefreshIcon />
                同步模型
              </button>
              <span className="field-hint" role={modelNeedsSelection ? 'status' : undefined}>
                {modelNeedsSelection
                  ? '当前会话模型未在 Desktop 中启用，请选择已启用模型后发送；更改勾选后可同步模型。'
                  : 'Plan 用于分析；Build 按 OpenCode 权限执行，可能修改项目文件。'}
              </span>
            </div>
          ) : null}
          <OpenCodeMessages session={session} connected={Boolean(info?.connected)} />
          <OpenCodeActivity session={session} />
          {session?.error ? (
            <div className="status-banner" role="alert">
              {session.error}
            </div>
          ) : null}
          <form
            className="composer"
            onSubmit={(event) => {
              event.preventDefault()
              if (canSend) void send()
            }}
          >
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
                placeholder="描述编程任务，或从工具 / Prompt 模板填入内容；点击发送才开始执行"
              />
              <div className="composer-actions">
                <span className="field-hint">草稿仅保留在本次应用中</span>
                <span className="opencode-draft-count">{draft.length.toLocaleString()}/50,000</span>
                {running ? (
                  <button
                    type="button"
                    className="btn-ghost"
                    disabled={busy || session?.status !== 'running'}
                    onClick={() => void stop()}
                  >
                    <StopIcon />
                    停止任务
                  </button>
                ) : (
                  <button type="submit" className="btn-gold" disabled={!canSend}>
                    <SendIcon />
                    发送给 OpenCode
                  </button>
                )}
              </div>
            </div>
          </form>
        </section>
      </div>
    </div>
  )
}
