import type { JSX } from 'react'
import { AgentIcon } from './icons'
import type { AgentIconId } from './icons'

/** 统一的装饰图标，保留主题色和固定占位，避免列表刷新时跳动。 */
export function AgentMark({ agent }: { agent: AgentIconId }): JSX.Element {
  return (
    <span className="agent-icon" data-agent={agent} aria-hidden="true">
      <AgentIcon agent={agent} />
    </span>
  )
}

/** Agent 名称始终可见，图标不替代文字或改变筛选值。 */
export function AgentIdentity({
  agent,
  label
}: {
  agent: AgentIconId
  label: string
}): JSX.Element {
  return (
    <span className="agent-identity">
      <AgentMark agent={agent} />
      <span className="agent-identity-name">{label}</span>
    </span>
  )
}
