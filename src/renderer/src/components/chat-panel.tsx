import { useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'

import type { ChatMessage } from '@shared/types'
import { AGENT_PERMISSION_LABELS, AGENT_PERMISSION_MODES } from '@shared/types'
import type { PendingApprovalView, ToolCallView } from '../stores/app-store'
import { useAppStore } from '../stores/app-store'
import { Dropdown } from './dropdown'
import type { DropdownOption } from './dropdown'
import { RefreshIcon, SendIcon, StopIcon } from './icons'

export function ChatPanel(): JSX.Element {
  const conversations = useAppStore((state) => state.conversations)
  const activeConversationId = useAppStore((state) => state.activeConversationId)
  const messages = useAppStore((state) => state.messages)
  const streaming = useAppStore((state) => state.streaming)
  const error = useAppStore((state) => state.error)
  const toolCalls = useAppStore((state) => state.toolCalls)
  const pendingApproval = useAppStore((state) => state.pendingApproval)

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
        <div className="chat-head-right">
          <PermissionSelect />
          <div
            className={`chat-status${streaming ? ' streaming' : ''}`}
            aria-live="polite"
          >
            {streaming ? '生成中 · STREAMING' : '就绪 · READY'}
          </div>
        </div>
      </header>

      <MessageList
        messages={messages}
        streamingContent={streamingContent}
        toolCalls={toolCalls}
      />

      {pendingApproval ? <ApprovalCard approval={pendingApproval} /> : null}

      {error ? (
        <div className="status-banner" role="alert">
          {error}
        </div>
      ) : null}

      <Composer />
    </section>
  )
}

function PermissionSelect(): JSX.Element {
  const agentPermission = useAppStore((state) => state.agentPermission)
  const setAgentPermission = useAppStore((state) => state.setAgentPermission)

  const options: DropdownOption[] = AGENT_PERMISSION_MODES.map((mode) => ({
    value: mode,
    label: AGENT_PERMISSION_LABELS[mode]
  }))

  return (
    <Dropdown
      ariaLabel="Agent 权限档位"
      value={agentPermission}
      options={options}
      triggerClassName="dropdown-compact"
      onChange={(value) => void setAgentPermission(value as typeof agentPermission)}
    />
  )
}

interface MessageListProps {
  messages: ChatMessage[]
  streamingContent: string | null
  toolCalls: ToolCallView[]
}

function MessageList({
  messages,
  streamingContent,
  toolCalls
}: MessageListProps): JSX.Element {
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const element = listRef.current
    if (!element) return
    element.scrollTop = element.scrollHeight
  }, [messages.length, streamingContent, toolCalls.length])

  const empty = messages.length === 0 && streamingContent === null && toolCalls.length === 0

  return (
    <div className="message-list" ref={listRef}>
      {empty ? (
        <div className="message-empty">
          <div>
            <p className="empty-title">开始新的星轨对话</p>
            <p className="empty-text">
              在右侧配置 OpenAI 兼容接口后，即可让 AI 帮你管理书架、密码箱与记事本。
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
          {toolCalls.map((call) => (
            <ToolCallCard key={call.callId} call={call} />
          ))}
          {streamingContent !== null ? (
            <MessageBubble role="assistant" content={streamingContent} streaming />
          ) : null}
        </>
      )}
    </div>
  )
}

function ToolCallCard({ call }: { call: ToolCallView }): JSX.Element {
  return (
    <div className={`tool-call ${call.status}`}>
      <div className="tool-call-head">
        <span className="tool-call-name">{call.name}</span>
        <span className="tool-call-status">
          {call.status === 'running' ? '执行中…' : call.status === 'ok' ? '完成' : '失败'}
        </span>
      </div>
      {call.args ? <div className="tool-call-args">{call.args}</div> : null}
      {call.summary && call.status !== 'running' ? (
        <div className="tool-call-summary">{call.summary}</div>
      ) : null}
    </div>
  )
}

function ApprovalCard({ approval }: { approval: PendingApprovalView }): JSX.Element {
  const respondToolApproval = useAppStore((state) => state.respondToolApproval)

  return (
    <div className="tool-approval" role="alertdialog" aria-label="需要确认的操作">
      <div className="tool-approval-head">
        <span>需要确认的操作</span>
        <span className={`tool-call-status ${approval.risk}`}>
          {approval.risk === 'destructive' ? '破坏性' : '写入'}
        </span>
      </div>
      <div className="tool-approval-name">{approval.name}</div>
      {approval.args ? <div className="tool-call-args">{approval.args}</div> : null}
      <div className="tool-approval-actions">
        <button
          type="button"
          className="btn-ghost"
          onClick={() => void respondToolApproval(false)}
        >
          拒绝
        </button>
        <button
          type="button"
          className="btn-gold"
          onClick={() => void respondToolApproval(true)}
        >
          允许
        </button>
      </div>
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
          <ModelSelect />
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

function ModelSelect(): JSX.Element | null {
  const settings = useAppStore((state) => state.settings)
  const chatModels = useAppStore((state) => state.chatModels)
  const loading = useAppStore((state) => state.chatModelsLoading)
  const selectModel = useAppStore((state) => state.selectModel)
  const refreshChatModels = useAppStore((state) => state.refreshChatModels)

  const active = settings?.profiles.find((item) => item.id === settings.activeId) ?? null
  if (!active) return null

  const options: DropdownOption[] = (
    chatModels.length > 0 ? chatModels : active.model ? [active.model] : []
  ).map((model) => ({ value: model, label: model }))

  return (
    <div className="model-select">
      <Dropdown
        ariaLabel="选择模型"
        value={active.model}
        options={options}
        placeholder="未选择模型"
        triggerClassName="dropdown-compact dropdown-model"
        onChange={(value) => void selectModel(value)}
      />
      <button
        type="button"
        className="icon-btn"
        title="从供应商拉取模型列表"
        aria-label="刷新模型列表"
        disabled={loading}
        onClick={() => void refreshChatModels()}
      >
        <RefreshIcon />
      </button>
    </div>
  )
}
