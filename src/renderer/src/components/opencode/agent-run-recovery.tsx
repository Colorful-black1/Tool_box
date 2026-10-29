import type { JSX } from 'react'
import type { CodingAgentSessionView } from '@shared/coding-agents'
import { useCodingAgentStore } from '../../stores/coding-agent-store'

/** 不把未知结果当作失败重试，所有恢复入口都不直接发送任务。 */
export function AgentRunRecovery({
  session
}: {
  session?: CodingAgentSessionView
}): JSX.Element | null {
  const busy = useCodingAgentStore((state) => state.busy)
  const running = useCodingAgentStore((state) =>
    Boolean(state.runs[state.runtimeId] || state.preparations[state.runtimeId])
  )
  const refresh = useCodingAgentStore((state) => state.refreshSession)
  const recall = useCodingAgentStore((state) => state.recallMessage)
  if (!session || running || !session.outcome || session.outcome === 'completed') return null
  const message = [...session.messages].reverse().find((item) => item.role === 'user')
  const unknown = session.outcome === 'unknown'
  return (
    <div className="status-banner agent-recovery" role="status" aria-label="任务恢复操作">
      <span>
        {unknown
          ? '任务结果未知，请先核对原生历史；未自动重发。'
          : session.outcome === 'stopped'
            ? '已停止，之前完成的操作可能保留。'
            : '本轮未成功，已执行的操作可能保留；取回后发送将追加新消息。'}
      </span>
      <button type="button" className="btn-ghost" disabled={busy} onClick={() => void refresh()}>
        核对原生历史
      </button>
      {!unknown && message ? (
        <button
          type="button"
          className="btn-ghost"
          disabled={busy}
          onClick={() => void recall(message.id)}
        >
          取回最近提问
        </button>
      ) : null}
    </div>
  )
}
