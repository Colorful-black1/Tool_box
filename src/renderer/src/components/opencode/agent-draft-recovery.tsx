import { useState } from 'react'
import type { JSX } from 'react'
import { CODING_AGENT_NAMES } from '@shared/coding-agents'
import { draftIdentity } from '@shared/agent-drafts'
import { useAgentDraftSaveStore, retryAgentDraftSave } from '../../lib/agent-draft-sync'
import { useCodingAgentStore } from '../../stores/coding-agent-store'

/** 原生历史失效也能主动取回草稿；取回只准备输入框。 */
export function AgentDraftRecovery(): JSX.Element {
  const status = useAgentDraftSaveStore((state) => state.status)
  const message = useAgentDraftSaveStore((state) => state.message)
  const entries = useAgentDraftSaveStore((state) => state.entries)
  const busy = useCodingAgentStore((state) => state.busy)
  const running = useCodingAgentStore((state) => state.runningRuntime)
  const directory = useCodingAgentStore((state) => state.directory)
  const draft = useCodingAgentStore((state) => state.draft)
  const [expanded, setExpanded] = useState(false)
  return (
    <div className="agent-draft-recovery">
      <div className="agent-draft-status" aria-live="polite">
        <span className="field-hint">
          {!directory && draft
            ? '选择项目后才会保存，当前文字暂存于窗口'
            : {
                loading: '读取草稿中…',
                saving: '草稿保存中…',
                saved: '草稿已加密保存',
                error: '草稿保存失败'
              }[status]}
        </span>
        {status === 'error' ? (
          <button type="button" className="btn-ghost" onClick={() => void retryAgentDraftSave()}>
            重试保存
          </button>
        ) : null}
        <button
          type="button"
          className="btn-ghost"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          管理草稿（{entries.length}）
        </button>
      </div>
      {message ? <div className="status-banner">{message}</div> : null}
      {expanded ? (
        <div className="agent-draft-list">
          <p className="field-hint">
            取回为新对话草稿，不连接或发送。历史会话草稿仍保留，也可打开对应历史后继续编辑。
          </p>
          {entries.map((entry) => (
            <div className="agent-draft-row" key={draftIdentity(entry)}>
              <div>
                <strong>
                  {CODING_AGENT_NAMES[entry.runtimeId]} ·{' '}
                  {entry.nativeSessionId ? '历史会话' : '新对话'}
                </strong>
                <div className="field-hint">{entry.directory}</div>
                <p>{entry.content.slice(0, 100)}</p>
              </div>
              <button
                type="button"
                className="btn-ghost"
                disabled={busy || Boolean(running)}
                onClick={() => useCodingAgentStore.getState().retrieveDraft(entry)}
              >
                取回
              </button>
              <button
                type="button"
                className="btn-danger"
                onClick={() => {
                  if (window.confirm('清除此条未发送草稿？'))
                    useCodingAgentStore.getState().removeDrafts(draftIdentity(entry))
                }}
              >
                清除
              </button>
            </div>
          ))}
          {entries.length ? (
            <button
              type="button"
              className="btn-danger"
              onClick={() => {
                if (window.confirm('清除全部 Agent 未发送草稿？此操作无法撤销。'))
                  useCodingAgentStore.getState().removeDrafts()
              }}
            >
              清除全部草稿
            </button>
          ) : (
            <p className="field-hint">暂无已选择项目的草稿</p>
          )}
        </div>
      ) : null}
    </div>
  )
}
