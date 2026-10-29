import type { JSX } from 'react'
import { CODING_AGENT_NAMES, WORKBENCH_AGENT_IDS } from '@shared/coding-agents'
import { useCodingAgentStore } from '../../stores/coding-agent-store'

/** 每行绑定 Agent，查看、审批提示和停止不会跟随当前选中的标签串到其他任务。 */
export function AgentRunningTasks(): JSX.Element | null {
  const runs = useCodingAgentStore((state) => state.runs)
  const preparations = useCodingAgentStore((state) => state.preparations)
  const workspaces = useCodingAgentStore((state) => state.workspaces)
  const runtimeId = useCodingAgentStore((state) => state.runtimeId)
  const activeId = useCodingAgentStore((state) => state.activeId)
  const sessions = useCodingAgentStore((state) => state.sessions)
  const viewRunning = useCodingAgentStore((state) => state.viewRunning)
  const switchRuntime = useCodingAgentStore((state) => state.switchRuntime)
  const stop = useCodingAgentStore((state) => state.stop)
  const cancelPreparation = useCodingAgentStore((state) => state.cancelPreparation)
  const hidden = WORKBENCH_AGENT_IDS.filter(
    (id) =>
      (runs[id] && (id !== runtimeId || runs[id]?.sessionId !== activeId)) ||
      (preparations[id] && id !== runtimeId)
  )
  if (!hidden.length) return null
  return (
    <div aria-label="后台 Agent 任务">
      {hidden.map((id) => {
        const run = runs[id]
        const session = run
          ? (id === runtimeId ? sessions : workspaces[id]?.sessions)?.[run.sessionId]
          : undefined
        const preparing = !run && preparations[id]
        const stopping = session?.status === 'stopping'
        return (
          <div className="status-banner" role="status" key={id}>
            <span>
              {CODING_AGENT_NAMES[id]} ·{' '}
              {preparing
                ? '准备中'
                : session?.questions?.length
                  ? '等待回答'
                  : session?.approvals.length
                    ? '等待审批'
                    : stopping
                      ? '停止中'
                      : '执行中'}
              <span className="field-hint"> · {run?.directory ?? workspaces[id]?.directory}</span>
            </span>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => (preparing ? switchRuntime(id) : viewRunning(id))}
            >
              {preparing ? '查看准备' : '查看运行任务'}
            </button>
            <button
              type="button"
              className="btn-ghost"
              disabled={stopping}
              onClick={() => (preparing ? cancelPreparation(id) : void stop(id))}
            >
              {preparing ? '取消准备' : '停止任务'}
            </button>
          </div>
        )
      })}
    </div>
  )
}
