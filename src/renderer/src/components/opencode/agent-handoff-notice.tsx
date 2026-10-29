import type { JSX } from 'react'
import { CODING_AGENT_NAMES } from '@shared/coding-agents'
import { useCodingAgentStore } from '../../stores/coding-agent-store'

/** 单次转用的返回入口；未发送时不能把仍保留的原连接描述为已断开。 */
export function AgentHandoffNotice(): JSX.Element | null {
  const handoff = useCodingAgentStore((state) => state.handoff)
  const runtimeId = useCodingAgentStore((state) => state.runtimeId)
  const busy = useCodingAgentStore((state) => state.busy)
  const running = useCodingAgentStore((state) => Boolean(state.runs[state.runtimeId]))
  const preparing = useCodingAgentStore((state) => Boolean(state.preparations[state.runtimeId]))
  const returnProject = useCodingAgentStore((state) => state.returnProject)
  const dismiss = useCodingAgentStore((state) => state.dismissHandoff)
  if (!handoff) return null
  const connection = handoff.previousConnectionId
    ? handoff.connectionReplaced
      ? '原有连接已断开'
      : '原有连接将在发送时断开'
    : '原项目当前没有活动连接'
  return (
    <div
      className="status-banner opencode-desktop-hint agent-handoff-notice"
      role="status"
      aria-label="跨项目转用提示"
    >
      <span>
        已从 {CODING_AGENT_NAMES[handoff.sourceId]} 转入「{handoff.sourceDirectory}」。
        {CODING_AGENT_NAMES[runtimeId]} 原项目为「{handoff.previousDirectory}」，{connection}；
        原项目未发送草稿已保留，历史仍可从原生重新读取。
      </span>
      <button
        type="button"
        className="btn-ghost"
        disabled={busy || running || preparing}
        onClick={() => void returnProject()}
      >
        返回原项目
      </button>
      <button type="button" className="btn-ghost" onClick={dismiss}>
        关闭提示
      </button>
    </div>
  )
}
