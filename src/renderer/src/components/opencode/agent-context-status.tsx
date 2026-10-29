import { useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import type { CodingAgentSessionView } from '@shared/coding-agents'
import { formatCompact } from '@shared/usage-format'
import { Popover } from '../popover'

/** 小型状态入口只展示原生快照，展开详情不会发送模型请求。 */
export function AgentContextStatus({
  session,
  connected,
  canCompact,
  onCompact
}: {
  session?: CodingAgentSessionView
  connected: boolean
  canCompact: boolean
  onCompact(): void
}): JSX.Element {
  const anchor = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [now, setNow] = useState(Date.now)
  const usage = session?.contextUsage
  const timing = session?.timing
  const running = session?.status === 'running' || session?.status === 'stopping'
  useEffect(() => {
    setOpen(false)
  }, [session?.id])
  useEffect(() => {
    if (!running || !timing) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [running, timing])
  const stale =
    !connected ||
    usage?.stale ||
    Boolean(usage && timing && usage.measuredAt < timing.startedAt && running)
  const percent = usage?.windowTokens ? (usage.usedTokens / usage.windowTokens) * 100 : null
  const label =
    percent === null ? '未提供' : `${usage?.approximate ? '约 ' : ''}${Math.round(percent)}%`
  const elapsed = timing ? Math.max(0, timing.elapsedMs ?? now - timing.startedAt) : null
  if (!session) return <></>
  return (
    <div className="agent-context-status">
      <button
        type="button"
        className="btn-ghost"
        ref={anchor}
        aria-expanded={open}
        aria-label={`上下文 ${label}${stale && usage ? '，上次快照' : ''}`}
        title={`上下文 ${label}${stale && usage ? ' · 上次快照' : ''}`}
        onClick={() => setOpen(!open)}
      >
        上下文 {percent === null ? '—' : label}
        {stale && usage ? ' · 上次' : ''}
      </button>
      {elapsed !== null ? <span title="本轮耗时">{Math.floor(elapsed / 1000)} 秒</span> : null}
      {open ? (
        <Popover
          anchor={anchor}
          onClose={() => setOpen(false)}
          className="agent-context-popover"
          placement="top"
          matchAnchorWidth={false}
        >
          <strong>当前上下文</strong>
          {usage ? (
            <>
              <p>
                {usage.approximate ? '约 ' : ''}
                {formatCompact(usage.usedTokens)} /{' '}
                {usage.windowTokens ? formatCompact(usage.windowTokens) : '上限未提供'} Token
              </p>
              {percent !== null ? (
                <progress max={100} value={Math.min(100, percent)} aria-label="上下文使用率" />
              ) : null}
              {percent !== null && percent > 100 ? (
                <p className="field-hint">已超过窗口 {Math.round(percent - 100)}%</p>
              ) : null}
              <p className="field-hint">
                {usage.source === 'claude'
                  ? 'Claude 原生估算'
                  : usage.source === 'codex'
                    ? 'Codex 最近请求'
                    : 'ACP 原生报告'}{' '}
                · {usage.windowKind === 'compaction' ? '原生压缩窗口' : '原生上下文窗口'}
              </p>
              <p className="field-hint">
                {new Date(usage.measuredAt).toLocaleTimeString('zh-CN')} ·{' '}
                {stale ? '上次快照' : '响应后快照'}
              </p>
            </>
          ) : (
            <p className="field-hint">原生未提供用量。</p>
          )}
          <button
            type="button"
            className="btn-ghost"
            disabled={!canCompact}
            title="填入 /compact，发送后执行"
            onClick={() => {
              setOpen(false)
              onCompact()
            }}
          >
            准备压缩上下文
          </button>
        </Popover>
      ) : null}
    </div>
  )
}
