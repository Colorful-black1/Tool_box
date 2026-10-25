import { useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import type { OpenCodeSession } from '@shared/types'
import { renderMarkdown } from '../../lib/markdown'
import { CodeIcon } from '../icons'
import { useCodingAgentStore } from '../../stores/coding-agent-store'
import { CODING_AGENT_NAMES, WORKBENCH_AGENT_IDS } from '@shared/coding-agents'
import type { CodingAgentId } from '@shared/coding-agents'
import { Dropdown } from '../dropdown'

/** 只在用户位于底部时跟随更新，上滚后保持阅读位置。 */
export function OpenCodeMessages({
  session,
  agentName = 'OpenCode'
}: {
  session: OpenCodeSession | undefined
  agentName?: string
}): JSX.Element {
  const container = useRef<HTMLDivElement>(null)
  const following = useRef(true)
  const [away, setAway] = useState(false)
  const [copied, setCopied] = useState<{ id: string; message: string } | null>(null)
  const runtimeId = useCodingAgentStore((state) => state.runtimeId)
  const transferMessage = useCodingAgentStore((state) => state.transferMessage)
  const targetId = runtimeId === 'opencode' ? 'codex' : 'opencode'
  const targetName = CODING_AGENT_NAMES[targetId]
  const id = session?.id
  const lastText = session?.messages.at(-1)?.content
  const copyMessage = async (messageId: string, content: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(content)
      setCopied({ id: messageId, message: '已复制' })
    } catch {
      setCopied({ id: messageId, message: '复制失败，请选中文字后复制' })
    }
  }
  useEffect(() => {
    following.current = true
    setAway(false)
    const frame = requestAnimationFrame(() => {
      if (container.current) container.current.scrollTop = container.current.scrollHeight
    })
    return () => cancelAnimationFrame(frame)
  }, [id])
  useEffect(() => {
    if (!following.current) return
    const frame = requestAnimationFrame(() => {
      if (container.current) container.current.scrollTop = container.current.scrollHeight
    })
    return () => cancelAnimationFrame(frame)
  }, [lastText])
  return (
    <div className="opencode-messages-wrap">
      <div
        className="message-list opencode-messages"
        ref={container}
        aria-label="编程会话消息"
        onScroll={() => {
          const element = container.current
          if (!element) return
          following.current = element.scrollHeight - element.clientHeight - element.scrollTop < 80
          setAway(!following.current)
        }}
      >
        {!session?.messages.length ? (
          <div className="opencode-empty" role="status">
            <span className="opencode-empty-icon">
              <CodeIcon />
            </span>
            <h3>从一个明确的任务开始</h3>
            <p>在下方输入任务即可开始，也可以从左侧继续历史会话。</p>
            <span className="field-hint">
              例如：先阅读项目结构，列出入口和核心模块，不修改文件。
            </span>
          </div>
        ) : (
          session.messages.map((message) => (
            <article className={`message ${message.role}`} key={message.id}>
              <div className="message-meta">{message.role === 'user' ? '你' : agentName}</div>
              {message.role === 'assistant' ? (
                <div
                  className="markdown-body"
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(message.content) }}
                />
              ) : (
                <div className="message-content">{message.content}</div>
              )}
              {message.role === 'assistant' && message.content ? (
                <div className="opencode-message-actions">
                  <button
                    type="button"
                    className="btn-ghost"
                    onClick={() => void copyMessage(message.id, message.content)}
                  >
                    复制
                  </button>
                  <button
                    type="button"
                    className="btn-ghost"
                    disabled={session.status === 'running' || session.status === 'stopping'}
                    onClick={() => transferMessage(message.id, targetId)}
                  >
                    用于 {targetName}
                  </button>
                  <Dropdown
                    ariaLabel="其他消息转用目标"
                    value=""
                    placeholder="其他 Agent"
                    options={WORKBENCH_AGENT_IDS.filter(
                      (id) => id !== runtimeId && id !== targetId
                    ).map((value) => ({ value, label: `用于 ${CODING_AGENT_NAMES[value]}` }))}
                    disabled={session.status === 'running' || session.status === 'stopping'}
                    onChange={(id) => transferMessage(message.id, id as CodingAgentId)}
                    align="left"
                  />
                  {copied?.id === message.id ? <span role="status">{copied.message}</span> : null}
                </div>
              ) : null}
            </article>
          ))
        )}
      </div>
      {away ? (
        <button
          type="button"
          className="btn-ghost opencode-latest"
          onClick={() => {
            following.current = true
            setAway(false)
            if (container.current) container.current.scrollTop = container.current.scrollHeight
          }}
        >
          回到最新
        </button>
      ) : null}
    </div>
  )
}
