import type { JSX } from 'react'
import type { OpenCodeSession } from '@shared/types'
import { useOpenCodeStore } from '../../stores/opencode-store'

const TOOL_STATUS: Record<string, string> = {
  pending: '等待',
  in_progress: '执行中',
  completed: '完成',
  failed: '失败'
}

/** 审批逐条展示，避免多个并行工具的审批卡把消息区与停止按钮挤出窗口。 */
export function OpenCodeActivity({
  session
}: {
  session: OpenCodeSession | undefined
}): JSX.Element {
  const busy = useOpenCodeStore((state) => state.busy)
  const approve = useOpenCodeStore((state) => state.approve)
  const approval = session?.approvals[0]
  return (
    <>
      {session?.tools.length ? (
        <details className="opencode-tools">
          <summary>工具执行记录 · {session.tools.length}</summary>
          <div>
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
          aria-label="OpenCode 操作审批"
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
