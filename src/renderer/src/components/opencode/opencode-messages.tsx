import { useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import type { OpenCodeSession } from '@shared/types'
import { renderMarkdown } from '../../lib/markdown'
import { CodeIcon } from '../icons'

/** 只在用户位于底部时跟随更新，上滚后保持阅读位置。 */
export function OpenCodeMessages({
  session,
  connected
}: {
  session: OpenCodeSession | undefined
  connected: boolean
}): JSX.Element {
  const container = useRef<HTMLDivElement>(null)
  const following = useRef(true)
  const [away, setAway] = useState(false)
  const id = session?.id
  const lastText = session?.messages.at(-1)?.content
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
            <h3>{!session && connected ? '选择一个编程会话' : '从一个明确的任务开始'}</h3>
            <p>
              {session
                ? '可以从 Prompt 模板填入任务，或在下方描述要分析的问题。'
                : connected
                  ? '点击左侧「新建编程会话」，或读取并选择 OpenCode 历史。连接不会自动创建会话。'
                  : '选择项目并连接 OpenCode 后，便可在这里使用编程 Agent。'}
            </p>
            <span className="field-hint">
              例如：先阅读项目结构，列出入口和核心模块，不修改文件。
            </span>
          </div>
        ) : (
          session.messages.map((message) => (
            <article className={`message ${message.role}`} key={message.id}>
              <div className="message-meta">{message.role === 'user' ? '你' : 'OpenCode'}</div>
              {message.role === 'assistant' ? (
                <div
                  className="markdown-body"
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(message.content) }}
                />
              ) : (
                <div className="message-content">{message.content}</div>
              )}
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
