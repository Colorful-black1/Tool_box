import type { JSX } from 'react'
import type { CodingAgentSessionView } from '@shared/coding-agents'
import { CODING_AGENT_NAMES } from '@shared/coding-agents'
import { Dropdown } from '../dropdown'
import { useCodingAgentStore } from '../../stores/coding-agent-store'

const OPTION_NAMES: Record<string, string> = {
  model: '模型',
  mode: '工作模式',
  permission: '操作权限',
  thought_level: '思考强度',
  reasoning: '思考强度'
}
const OPTION_ORDER: Record<string, number> = {
  mode: 0,
  permission: 0,
  model: 1,
  thought_level: 2,
  reasoning: 2
}

/** 常用原生选项直接放在输入区，不在显示层补造可用模型或权限。 */
export function AgentComposerOptions({
  session,
  disabled
}: {
  session?: CodingAgentSessionView
  disabled: boolean
}): JSX.Element {
  const info = useCodingAgentStore((state) => state.info)
  const runtimeId = useCodingAgentStore((state) => state.runtimeId)
  const setOption = useCodingAgentStore((state) => state.setOption)
  const visibleModels = new Set(info?.visibleModelIds ?? [])
  return (
    <div className="agent-composer-options" role="group" aria-label="会话参数">
      {[...(session?.options ?? [])]
        .sort((a, b) => (OPTION_ORDER[a.category] ?? 3) - (OPTION_ORDER[b.category] ?? 3))
        .map((option) => {
          const label = OPTION_NAMES[option.category] ?? option.name
          return (
            <div
              key={option.id}
              className="agent-composer-option"
              title={`${label}：${option.options.find((item) => item.value === option.currentValue)?.label ?? '未选择'}`}
            >
              <Dropdown
                ariaLabel={`${CODING_AGENT_NAMES[runtimeId]} ${label}`}
                triggerClassName="agent-option-trigger"
                value={option.currentValue}
                options={
                  option.category === 'model'
                    ? option.options.filter((item) => visibleModels.has(item.value))
                    : option.options
                }
                placeholder={`选择${label}`}
                onChange={(value) => void setOption(option.id, value)}
                disabled={disabled || !info?.connected}
                searchable={option.options.length > 8}
                align="left"
              />
            </div>
          )
        })}
    </div>
  )
}
