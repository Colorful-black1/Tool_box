import type { JSX } from 'react'

import { EXTENSION_AGENTS } from '@shared/extensions'
import type { ExtensionAgentId } from '@shared/extensions'

import { AgentIdentity } from '../agent-identity'
import type { AgentIconId } from '../icons'

/** 只有这些 Agent 有现成图标；其余用文字徽标，避免造新图标。 */
const ICONS: Partial<Record<ExtensionAgentId, AgentIconId>> = {
  claude: 'claude',
  codex: 'codex',
  opencode: 'opencode',
  dsh: 'dsh',
  'claude-desktop': 'claude-desktop',
  gemini: 'gemini'
}

/** Agent 徽标：名称始终可见，图标只是辅助。 */
export function AgentChips({ agents }: { agents: ExtensionAgentId[] }): JSX.Element {
  if (!agents.length) return <span className="ext-chip ext-chip-muted">未接入 Agent</span>
  return (
    <span className="ext-chips">
      {agents.map((agent) => {
        const icon = ICONS[agent]
        return icon ? (
          <AgentIdentity key={agent} agent={icon} label={EXTENSION_AGENTS[agent]} />
        ) : (
          <span className="ext-chip" key={agent}>
            {EXTENSION_AGENTS[agent]}
          </span>
        )
      })}
    </span>
  )
}
