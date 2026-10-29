import type { JSX } from 'react'
import type { CodingAgentSessionView } from '@shared/coding-agents'
import { useCodingAgentStore as useOpenCodeStore } from '../../stores/coding-agent-store'
import { AgentQuestionCard } from './agent-question-card'

const TOOL_STATUS: Record<string, string> = {
  pending: '等待',
  in_progress: '执行中',
  completed: '完成',
  failed: '失败'
}

const SUBTASK_STATUS: Record<string, string> = {
  pendingInit: '等待初始化',
  running: '执行中',
  started: '已启动',
  interacted: '状态更新',
  interrupted: '已中断',
  completed: '完成',
  errored: '失败',
  shutdown: '已关闭',
  notFound: '未找到',
  unknown: '状态未知'
}

/** 审批逐条展示，避免多个并行工具的审批卡把消息区与停止按钮挤出窗口。 */
export function OpenCodeActivity({
  session,
  agentName = 'OpenCode'
}: {
  session: CodingAgentSessionView | undefined
  agentName?: string
}): JSX.Element {
  const busy = useOpenCodeStore((state) => state.busy)
  const approve = useOpenCodeStore((state) => state.approve)
  const capabilities = useOpenCodeStore((state) => state.info?.capabilities)
  const approval = session?.approvals[0]
  return (
    <>
      {session?.questions?.[0] ? (
        <AgentQuestionCard key={session.questions[0].id} request={session.questions[0]} />
      ) : null}
      {session && (session.tools.length > 0 || session.subtasks.length > 0) ? (
        <details className="opencode-tools">
          <summary>
            执行详情 · {session.tools.length} 项工具 / {session.subtasks.length} 项子任务
          </summary>
          <div>
            <p className="field-hint">
              {capabilities?.subagents === 'supported'
                ? '由原生 Agent 调度，仅展示接口提供的状态与结果；不支持在此单独停止子任务。'
                : '当前接口未提供完整子任务详情，可查看工具摘要；内部调度仍由原生 Agent 负责。'}
            </p>
            {session.subtasks.map((task) => (
              <p key={task.id}>
                <span>{SUBTASK_STATUS[task.status] ?? '状态未知'}</span> {task.title}
                {task.result ? `：${task.result}` : ''}
              </p>
            ))}
            {session.tools.map((tool) => (
              <p key={tool.id}>
                <span>
                  {Object.hasOwn(TOOL_STATUS, tool.status) ? TOOL_STATUS[tool.status] : '状态更新'}
                </span>{' '}
                {tool.title}
              </p>
            ))}
          </div>
        </details>
      ) : null}
      {approval ? (
        <section
          className="opencode-approval"
          key={approval.id}
          role="region"
          aria-label={`${agentName} 操作审批`}
        >
          <strong>{approval.title}</strong>
          {session && session.approvals.length > 1 ? (
            <span className="field-hint"> · 共 {session.approvals.length} 项待审批</span>
          ) : null}
          <pre>{approval.details}</pre>
          <div className="tool-controls">
            <button
              type="button"
              className="btn-gold"
              disabled={busy || !approval.canAllow}
              onClick={() => void approve(approval.id, true)}
            >
              允许这一次
            </button>
            <button
              type="button"
              className="btn-ghost"
              disabled={busy}
              onClick={() => void approve(approval.id, false)}
            >
              拒绝操作
            </button>
          </div>
        </section>
      ) : null}
    </>
  )
}
