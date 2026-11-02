import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { JSX } from 'react'
import type { CodingAgentSessionView } from '@shared/coding-agents'
import { renderMarkdown } from '../../lib/markdown'
import { agentUserMessageText } from '../../lib/agent-message-text'
import { buildMessageNote } from '@shared/message-note'
import { useAppStore } from '../../stores/app-store'
import { CodeIcon } from '../icons'
import { useCodingAgentStore } from '../../stores/coding-agent-store'
import { CODING_AGENT_NAMES, WORKBENCH_AGENT_IDS } from '@shared/coding-agents'
import { mergeSessionMessages } from '@shared/coding-agent-messages'
import { AgentIdentity, AgentMark } from '../agent-identity'
import type { CodingAgentId } from '@shared/coding-agents'
import { Dropdown } from '../dropdown'

/** 只在用户位于底部时跟随更新，上滚后保持阅读位置。 */
export function OpenCodeMessages({
  session,
  agentName = 'OpenCode'
}: {
  session: CodingAgentSessionView | undefined
  agentName?: string
}): JSX.Element {
  const container = useRef<HTMLDivElement>(null)
  const following = useRef(true)
  const [away, setAway] = useState(false)
  const [copied, setCopied] = useState<{ id: string; message: string } | null>(null)
  const [noteState, setNoteState] = useState<{ id: string; message: string } | null>(null)
  const runtimeId = useCodingAgentStore((state) => state.runtimeId)
  const transferMessage = useCodingAgentStore((state) => state.transferMessage)
  const recallMessage = useCodingAgentStore((state) => state.recallMessage)
  const revertMessage = useCodingAgentStore((state) => state.revertMessage)
  const busy = useCodingAgentStore((state) => state.busy)
  const targetId = runtimeId === 'opencode' ? 'codex' : 'opencode'
  const targetName = CODING_AGENT_NAMES[targetId]
  const id = session?.id
  const earlier = useCodingAgentStore((state) => (id ? state.earlier[id] : undefined))
  const loadEarlier = useCodingAgentStore((state) => state.loadEarlier)
  const pendingHeight = useRef<number | null>(null)
  const lastText = session?.messages.at(-1)?.content
  const window = session?.messageWindow
  const hasEarlier = earlier?.hasMore ?? window?.hasMore ?? false
  const truncated = earlier?.truncated ?? window?.truncated ?? 0
  const merged = useMemo(
    () => mergeSessionMessages(earlier?.items ?? [], session?.messages ?? []),
    [earlier?.items, session?.messages]
  )
  const messages = merged.map((message) =>
    message.role === 'user'
      ? { ...message, content: agentUserMessageText(message.content) }
      : message
  )
  const copyMessage = async (messageId: string, content: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(content)
      setCopied({ id: messageId, message: '已复制' })
    } catch {
      setCopied({ id: messageId, message: '复制失败，请选中文字后复制' })
    }
  }
  const saveNote = async (messageId: string, content: string): Promise<void> => {
    const note = buildMessageNote({
      content,
      origin: `${agentName} · ${session?.title ?? '编程会话'}`
    })
    if (!note) {
      setNoteState({ id: messageId, message: '没有可保存的内容' })
      return
    }
    try {
      await useAppStore.getState().saveNote(note)
      setNoteState({ id: messageId, message: '已存入记事本' })
    } catch {
      setNoteState({ id: messageId, message: '保存失败，请重试' })
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
  // 插入更早的消息后按高度差补偿滚动位置，阅读位置不跳。
  useLayoutEffect(() => {
    const element = container.current
    if (!element || pendingHeight.current === null) return
    const previous = pendingHeight.current
    pendingHeight.current = null
    element.scrollTop += element.scrollHeight - previous
  }, [messages.length])
  const requestEarlier = (): void => {
    if (!hasEarlier || earlier?.loading) return
    if (container.current) pendingHeight.current = container.current.scrollHeight
    void loadEarlier(id)
  }
  // 加载失败时清掉待补偿高度，避免下一条新消息到达时误跳。
  useEffect(() => {
    if (earlier?.failed) pendingHeight.current = null
  }, [earlier?.failed])
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
          // 滚到接近顶部时预取上一页；到顶且没有更多时不再请求。
          if (element.scrollTop < 60) requestEarlier()
        }}
      >
        {!messages.length || !session ? (
          <div className="opencode-empty" role="status">
            <span className="opencode-empty-icon">
              <CodeIcon />
            </span>
            <h3>开始新对话</h3>
          </div>
        ) : (
          <>
            {truncated > 0 ? (
              <div className="opencode-earlier-note" role="status">
                更早的 {truncated} 条已超出本机缓存，可在原生 Agent 中查看。
              </div>
            ) : null}
            {hasEarlier ? (
              <div className="opencode-earlier">
                {earlier?.loading ? (
                  <span role="status">正在加载更早消息…</span>
                ) : earlier?.failed ? (
                  <button type="button" className="btn-ghost" onClick={requestEarlier}>
                    加载失败，点击重试
                  </button>
                ) : (
                  <span>向上滚动加载更早消息</span>
                )}
              </div>
            ) : truncated > 0 ? null : (
              <div className="opencode-earlier" role="status">
                已到最早
              </div>
            )}
            {messages.map((message) => (
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
              {message.content ? (
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
                    aria-label="存入记事本"
                    onClick={() => void saveNote(message.id, message.content)}
                  >
                    {noteState?.id === message.id ? noteState.message : '存入记事本'}
                  </button>
                  {message.role === 'user' ? (
                    <>
                      <button
                        type="button"
                        className="btn-ghost"
                        onClick={() => void recallMessage(message.id)}
                      >
                        取回编辑
                      </button>
                      {session.canRevert ? (
                        <>
                          <button
                            type="button"
                            className="btn-ghost"
                            disabled={
                              busy || session.status === 'running' || session.status === 'stopping'
                            }
                            onClick={() => void revertMessage(message.id, false)}
                          >
                            回退到此处
                          </button>
                          <button
                            type="button"
                            className="btn-ghost"
                            disabled={
                              busy || session.status === 'running' || session.status === 'stopping'
                            }
                            onClick={() => void revertMessage(message.id, true)}
                          >
                            回退并编辑
                          </button>
                        </>
                      ) : null}
                    </>
                  ) : null}
                  <button
                    type="button"
                    className="btn-ghost"
                    disabled={session.status === 'running' || session.status === 'stopping'}
                    onClick={() => transferMessage(message.id, targetId)}
                  >
                    用于 <AgentIdentity agent={targetId} label={targetName} />
                  </button>
                  <Dropdown
                    ariaLabel="其他消息转用目标"
                    value=""
                    placeholder="其他 Agent"
                    options={WORKBENCH_AGENT_IDS.filter(
                      (id) => id !== runtimeId && id !== targetId
                    ).map((value) => ({
                      value,
                      label: `用于 ${CODING_AGENT_NAMES[value]}`,
                      icon: <AgentMark agent={value} />
                    }))}
                    disabled={session.status === 'running' || session.status === 'stopping'}
                    onChange={(id) => transferMessage(message.id, id as CodingAgentId)}
                    align="left"
                  />
                  {copied?.id === message.id ? <span role="status">{copied.message}</span> : null}
                </div>
              ) : null}
            </article>
            ))}
          </>
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
