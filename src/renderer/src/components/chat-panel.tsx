import { useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'

import type { ChatMessage } from '@shared/types'
import { useAppStore } from '../stores/app-store'
import { SendIcon, StopIcon } from './icons'

export function ChatPanel(): JSX.Element {
  const conversations = useAppStore((state) => state.conversations)
  const activeConversationId = useAppStore((state) => state.activeConversationId)
  const messages = useAppStore((state) => state.messages)
  const streaming = useAppStore((state) => state.streaming)
  const error = useAppStore((state) => state.error)

  const activeConversation = conversations.find(
    (item) => item.id === activeConversationId
  )
  const streamingContent =
    streaming && streaming.conversationId === activeConversationId
      ? streaming.content
      : null

  return (
    <section className="glass chat-panel" aria-label="对话区域">
      <header className="chat-head">
        <h2 className="chat-title">{activeConversation?.title ?? '未选择会话'}</h2>
        <div
          className={`chat-status${streaming ? ' streaming' : ''}`}
          aria-live="polite"
        >
          {streaming ? '生成中 · STREAMING' : '就绪 · READY'}
        </div>
      </header>

      <MessageList
        messages={messages}
        streamingContent={streamingContent}
      />

      {error ? (
        <div className="status-banner" role="alert">
          {error}
        </div>
      ) : null}

      <Composer />
    </section>
  )
}

interface MessageListProps {
  messages: ChatMessage[]
  streamingContent: string | null
}

function MessageList({ messages, streamingContent }: MessageListProps): JSX.Element {
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const element = listRef.current
    if (!element) return
    element.scrollTop = element.scrollHeight
  }, [messages.length, streamingContent])

  const empty = messages.length === 0 && streamingContent === null

  return (
    <div className="message-list" ref={listRef}>
      {empty ? (
        <div className="message-empty">
          <div>
            <p className="empty-title">开始新的星轨对话</p>
            <p className="empty-text">
              在右侧配置 OpenAI 兼容接口后，即可与本地 AI 助手对话。
            </p>
          </div>
        </div>
      ) : (
        <>
          {messages.map((message) => (
            <MessageBubble
              key={message.id}
              role={message.role}
              content={message.content}
            />
          ))}
          {streamingContent !== null ? (
            <MessageBubble role="assistant" content={streamingContent} streaming />
          ) : null}
        </>
      )}
    </div>
  )
}

interface MessageBubbleProps {
  role: ChatMessage['role']
  content: string
  streaming?: boolean
}

function MessageBubble({
  role,
  content,
  streaming = false
}: MessageBubbleProps): JSX.Element {
  return (
    <div className={`message-row ${role}`}>
      <div className="message-bubble">
        <div className="message-role">{role === 'user' ? '我 · USER' : 'AI · ASSISTANT'}</div>
        <div className="message-content">
          {content || (streaming ? '正在连接模型…' : '')}
          {streaming ? (
            <span className="typing-dots" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function Composer(): JSX.Element {
  const activeConversationId = useAppStore((state) => state.activeConversationId)
  const streaming = useAppStore((state) => state.streaming)
  const sendMessage = useAppStore((state) => state.sendMessage)
  const stopGeneration = useAppStore((state) => state.stopGeneration)
  const [value, setValue] = useState('')

  const isStreaming = streaming !== null
  const canSend = !isStreaming && activeConversationId !== null && value.trim().length > 0

  const submit = (): void => {
    const content = value.trim()
    if (!canSend || !content) return
    setValue('')
    void sendMessage(content)
  }

  return (
    <form
      className="composer"
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
    >
      <div className="composer-box">
        <label className="sr-only" htmlFor="chat-input">
          输入消息
        </label>
        <textarea
          id="chat-input"
          className="composer-input"
          rows={3}
          value={value}
          placeholder="输入消息，Enter 发送，Shift + Enter 换行"
          disabled={!activeConversationId}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              submit()
            }
          }}
        />
        <div className="composer-actions">
          {isStreaming ? (
            <button
              type="button"
              className="btn-ghost"
              onClick={() => void stopGeneration()}
            >
              <StopIcon />
              停止
            </button>
          ) : (
            <button type="submit" className="btn-gold" disabled={!canSend}>
              <SendIcon />
              发送
            </button>
          )}
        </div>
      </div>
    </form>
  )
}
