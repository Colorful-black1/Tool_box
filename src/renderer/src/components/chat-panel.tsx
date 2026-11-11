import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { JSX } from 'react'

import type { ChatCheckpointView, ChatContextView, ChatMessage } from '@shared/types'
import { AGENT_PERMISSION_LABELS, AGENT_PERMISSION_MODES } from '@shared/types'
import { formatCompact } from '@shared/usage-format'
import type { PendingApprovalView } from '../stores/app-store'
import { useAppStore } from '../stores/app-store'
import { renderMarkdown } from '../lib/markdown'
import { buildMessageNote } from '@shared/message-note'
import { openAppReference } from '../lib/open-app-reference'
import { Dropdown } from './dropdown'
import type { DropdownOption } from './dropdown'
import { Popover } from './popover'
import { SendIcon, StopIcon } from './icons'

export function ChatPanel(): JSX.Element {
  const conversations = useAppStore((state) => state.conversations)
  const activeConversationId = useAppStore((state) => state.activeConversationId)
  const messages = useAppStore((state) => state.messages)
  const streaming = useAppStore((state) => state.streaming)
  const compacting = useAppStore((state) => state.compacting)
  const context = useAppStore((state) => state.context)
  const error = useAppStore((state) => state.error)
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
          <ContextMeter context={context} />
          <PermissionSelect />
          <div
            className={`chat-status${streaming || compacting ? ' streaming' : ''}`}
            aria-live="polite"
          >
            {compacting
              ? '压缩上下文 · COMPACTING'
              : streaming
                ? '生成中 · STREAMING'
                : '就绪 · READY'}
          </div>
        </div>
      </header>

      <MessageList
        key={activeConversationId ?? 'empty'}
        messages={messages}
        streamingContent={streamingContent}
        checkpoint={context?.checkpoint ?? null}
        compacting={compacting}
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

const WINDOW_SOURCE_LABELS: Record<ChatContextView['windowSource'], string> = {
  manual: '手动设置',
  api: '模型接口',
  learned: '错误学习',
  catalog: '模型目录',
  default: '默认 128k'
}

function ContextMeter({ context }: { context: ChatContextView | null }): JSX.Element | null {
  const compacting = useAppStore((state) => state.compacting)
  const settings = useAppStore((state) => state.settings)
  const compactContext = useAppStore((state) => state.compactContext)
  const refreshContext = useAppStore((state) => state.refreshContext)
  const anchor = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [toggling, setToggling] = useState(false)

  useEffect(() => {
    setOpen(false)
  }, [context?.conversationId])

  if (!context) return null

  const percent = Math.max(0, context.percent)
  const label = `${Math.round(percent)}%`
  const level = percent >= 100 ? ' over' : percent >= 80 ? ' near' : ''
  const configured = Boolean(
    settings?.activeId && settings.profiles.some((item) => item.id === settings.activeId)
  )
  const checkpoint = context.checkpoint

  const toggleAuto = async (): Promise<void> => {
    if (toggling) return
    setToggling(true)
    try {
      await window.toolbox.config.set({ contextAutoCompact: !context.autoCompact })
      await refreshContext()
    } finally {
      setToggling(false)
    }
  }

  return (
    <div className="chat-context">
      <button
        type="button"
        ref={anchor}
        className={`btn-ghost chat-context-trigger${level}`}
        aria-expanded={open}
        aria-label={`上下文约 ${label}，${formatCompact(context.estimatedTokens)} / ${formatCompact(context.windowTokens)} token`}
        title={`上下文约 ${label}`}
        onClick={() => setOpen(!open)}
      >
        上下文 {label}
      </button>
      {open ? (
        <Popover
          anchor={anchor}
          onClose={() => setOpen(false)}
          className="agent-context-popover chat-context-popover"
          placement="auto"
          matchAnchorWidth={false}
        >
          <strong>当前上下文</strong>
          <p>
            约 {formatCompact(context.estimatedTokens)} / {formatCompact(context.windowTokens)} Token
            {' · '}
            {label}
          </p>
          <progress max={100} value={Math.min(100, percent)} aria-label="上下文使用率" />
          {percent >= 100 ? (
            <p className="field-hint">已超过窗口 {Math.round(percent - 100)}%</p>
          ) : null}
          <dl className="chat-context-breakdown">
            <div>
              <dt>系统提示</dt>
              <dd>{formatCompact(context.breakdown.system)}</dd>
            </div>
            <div>
              <dt>工具定义</dt>
              <dd>{formatCompact(context.breakdown.tools)}</dd>
            </div>
            <div>
              <dt>检查点摘要</dt>
              <dd>{formatCompact(context.breakdown.summary)}</dd>
            </div>
            <div>
              <dt>最近消息</dt>
              <dd>{formatCompact(context.breakdown.messages)}</dd>
            </div>
          </dl>
          <p className="field-hint">
            窗口来源：{WINDOW_SOURCE_LABELS[context.windowSource]} · 压缩阈值{' '}
            {formatCompact(context.thresholdTokens)}
          </p>
          {context.lastUsage ? (
            <p className="field-hint">
              上次实测：{formatCompact(context.lastUsage.inputTokens + context.lastUsage.outputTokens)}{' '}
              Token（含工具过程，可能高于下一轮）
            </p>
          ) : (
            <p className="field-hint">尚无实测用量，当前为估算值。</p>
          )}
          {checkpoint ? (
            <p className="field-hint">
              上次压缩：{new Date(checkpoint.createdAtMs).toLocaleString('zh-CN')} · 覆盖{' '}
              {checkpoint.coveredMessageCount} 条 · 释放约{' '}
              {formatCompact(Math.max(0, checkpoint.sourceTokens - checkpoint.tokens))} Token
              {checkpoint.omittedMessageCount > 0
                ? ` · 另有 ${checkpoint.omittedMessageCount} 条最早消息未纳入摘要`
                : ''}
            </p>
          ) : null}
          <div className="chat-context-actions">
            <button
              type="button"
              className="btn-ghost"
              disabled={compacting || !configured || context.messageCount <= 2}
              onClick={() => {
                setOpen(false)
                void compactContext()
              }}
            >
              {compacting ? '压缩中…' : '立即压缩'}
            </button>
            <button
              type="button"
              className={`toggle-switch${context.autoCompact ? ' on' : ''}`}
              role="switch"
              aria-checked={context.autoCompact}
              aria-label="自动压缩"
              disabled={toggling}
              onClick={() => void toggleAuto()}
            >
              <span aria-hidden="true" />
            </button>
            <span className="field-hint">自动压缩</span>
          </div>
          <p className="field-hint">压缩会额外调用一次模型，可能产生费用。</p>
        </Popover>
      ) : null}
    </div>
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
  checkpoint: ChatCheckpointView | null
  compacting: boolean
}

/**
 * 消息流。
 *
 * **不渲染工具调用卡片**：查书架、读分组这些是 AI 的后台动作，
 * 属于「过程」而不是「回答」，摆在回答旁边只会让人以为出了什么错。
 * 需要人工确认的写操作由单独的审批卡承担（见 {@link ApprovalCard}），
 * 那种必须露出来。
 */
function MessageList({
  messages,
  streamingContent,
  checkpoint,
  compacting
}: MessageListProps): JSX.Element {
  const listRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const following = useRef(true)
  const settings = useAppStore((state) => state.settings)
  const setView = useAppStore((state) => state.setView)
  const activeProfileId = settings?.activeId ?? ''
  // 与发送时主进程的判定保持一致：有启用中的档案才算配置完成。
  const configured = Boolean(
    activeProfileId && settings?.profiles.some((item) => item.id === activeProfileId)
  )
  const [awayFromBottom, setAwayFromBottom] = useState(false)

  const scrollToLatest = useCallback(() => {
    const element = listRef.current
    if (!element) return
    following.current = true
    element.scrollTop = element.scrollHeight
    setAwayFromBottom(false)
  }, [])

  useLayoutEffect(() => {
    if (following.current) scrollToLatest()
  }, [messages, streamingContent, scrollToLatest])

  useEffect(() => {
    const observer = new ResizeObserver(() => {
      const element = listRef.current
      if (!element) return
      if (following.current) scrollToLatest()
      else if (element.scrollHeight - element.clientHeight - element.scrollTop <= 48) {
        following.current = true
        setAwayFromBottom(false)
      }
    })
    if (listRef.current) observer.observe(listRef.current)
    if (contentRef.current) observer.observe(contentRef.current)
    return () => observer.disconnect()
  }, [scrollToLatest])

  const empty = messages.length === 0 && streamingContent === null
  const checkpointIndex = checkpoint
    ? messages.findIndex((message) => message.id === checkpoint.coveredMessageId)
    : -1

  return (
    <div className="message-thread">
      <div
        className="message-list"
        ref={listRef}
        tabIndex={0}
        aria-label="对话消息"
        onScroll={(event) => {
          const element = event.currentTarget
          const atBottom = element.scrollHeight - element.clientHeight - element.scrollTop <= 48
          // 记录用户的跟随意图，避免新内容增加高度后把正在阅读历史的用户拉回底部。
          following.current = atBottom
          setAwayFromBottom(!atBottom)
        }}
      >
        <div ref={contentRef} className={empty ? 'message-empty-fill' : undefined}>
          {empty ? (
            <div className="message-empty">
              <div>
                <p className="empty-title">
                  {configured ? '开始新的星轨对话' : '先完成 AI 配置'}
                </p>
                <p className="empty-text">
                  {configured
                    ? '输入消息开始对话，也可以让我管理书架、笔记和待办。'
                    : '配置供应商与 API Key 后即可对话；书架、笔记和待办也可交给 AI 管理。'}
                </p>
                {configured ? null : (
                  <button type="button" className="btn-gold" onClick={() => setView('settings')}>
                    去设置配置 AI
                  </button>
                )}
              </div>
            </div>
          ) : (
            <>
              {checkpoint && checkpointIndex < 0 ? <CheckpointCard checkpoint={checkpoint} /> : null}
              {messages.map((message, index) => (
                <Fragment key={message.id}>
                  <MessageBubble
                    role={message.role}
                    content={message.content}
                    createdAtMs={message.createdAtMs}
                  />
                  {checkpoint && index === checkpointIndex ? (
                    <CheckpointCard checkpoint={checkpoint} />
                  ) : null}
                </Fragment>
              ))}
              {streamingContent !== null ? (
                <MessageBubble
                  role="assistant"
                  content={streamingContent}
                  streaming
                  placeholder={compacting ? '正在压缩上下文…' : undefined}
                />
              ) : null}
            </>
          )}
        </div>
      </div>
      {awayFromBottom ? (
        <button type="button" className="btn-ghost message-jump" onClick={scrollToLatest}>
          回到最新
        </button>
      ) : null}
    </div>
  )
}

function CheckpointCard({ checkpoint }: { checkpoint: ChatCheckpointView }): JSX.Element {
  return (
    <div className="chat-checkpoint">
      <div className="chat-checkpoint-head">
        已压缩 {checkpoint.coveredMessageCount} 条更早消息
        <span className="chat-checkpoint-meta">
          {new Date(checkpoint.createdAtMs).toLocaleString('zh-CN')}
        </span>
      </div>
      <p className="field-hint">
        原始消息仍保留在下方，仅发送给模型时使用摘要。
        {checkpoint.omittedMessageCount > 0
          ? ` 另有 ${checkpoint.omittedMessageCount} 条最早消息未纳入摘要。`
          : ''}
      </p>
      <details>
        <summary>查看摘要</summary>
        <pre>{checkpoint.summary}</pre>
      </details>
    </div>
  )
}

function ApprovalCard({ approval }: { approval: PendingApprovalView }): JSX.Element {
  const respondToolApproval = useAppStore((state) => state.respondToolApproval)
  const labels: Record<string, string> = {
    notes_edit: '核对笔记修改', todos_save: '保存待办', todos_set_state: '更新待办状态',
    commands_create: '新增到命令速查'
  }

  return (
    <div className="tool-approval" role="alertdialog" aria-label="需要确认的操作">
      <div className="tool-approval-head">
        <span>需要确认的操作</span>
        <span className={`tool-call-status ${approval.risk}`}>
          {approval.risk === 'destructive' ? '破坏性' : '写入'}
        </span>
      </div>
      <div className="tool-approval-name">{labels[approval.name] ?? approval.name}</div>
      {approval.args ? <div className="tool-call-args" tabIndex={0} aria-label="操作预览">{approval.args}</div> : null}
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
  createdAtMs?: number
  streaming?: boolean
  placeholder?: string
}

function MessageBubble({
  role,
  content,
  createdAtMs,
  streaming = false,
  placeholder
}: MessageBubbleProps): JSX.Element {
  const copyText = useAppStore((state) => state.copyText)
  const conversationTitle = useAppStore(
    (state) =>
      state.conversations.find((item) => item.id === state.activeConversationId)?.title ?? ''
  )
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const [noteState, setNoteState] = useState<'idle' | 'saved' | 'failed'>('idle')
  const [openError, setOpenError] = useState('')
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const noteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      if (noteTimerRef.current) clearTimeout(noteTimerRef.current)
    }
  }, [])

  const copy = (): void => {
    void copyText(content)
      .then(() => {
        setCopyState('copied')
        if (timerRef.current) clearTimeout(timerRef.current)
        timerRef.current = setTimeout(() => setCopyState('idle'), 1500)
      })
      .catch(() => setCopyState('failed'))
  }

  const saveAsNote = (): void => {
    const note = buildMessageNote({
      content,
      origin: conversationTitle ? `星轨对话 · ${conversationTitle}` : '星轨对话'
    })
    if (!note) {
      setNoteState('failed')
      return
    }
    void useAppStore
      .getState()
      .saveNote(note)
      .then(() => {
        setNoteState('saved')
        if (noteTimerRef.current) clearTimeout(noteTimerRef.current)
        noteTimerRef.current = setTimeout(() => setNoteState('idle'), 1500)
      })
      .catch(() => setNoteState('failed'))
  }

  const isAssistant = role === 'assistant'

  return (
    <div className={`message-row ${role}`}>
      <div className="message-bubble">
        <div className="message-role">{isAssistant ? 'AI · ASSISTANT' : '我 · USER'}</div>
        <div className="message-content">
          {isAssistant ? (
            content.trim() ? (
              <div
                className="message-md markdown-body md-chat"
                onClick={(event) => {
                  const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('[data-app-target]') : null
                  const href = button?.dataset.appTarget
                  if (!href) return
                  event.preventDefault()
                  setOpenError('')
                  button.disabled = true
                  void openAppReference(href).catch((error: unknown) => {
                    setOpenError(error instanceof Error ? error.message : '无法打开结果，请重新查询')
                  }).finally(() => { button.disabled = false })
                }}
                dangerouslySetInnerHTML={{ __html: renderMarkdown(content, true) }}
              />
            ) : (
              streaming && (placeholder ?? '正在连接模型…')
            )
          ) : (
            content
          )}
          {streaming ? (
            <span className="typing-dots" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
          ) : null}
        </div>
        {openError ? <p className="status-banner" role="alert">{openError}</p> : null}
        {createdAtMs !== undefined ? (
          <div className="message-foot">
            <span className="message-time">{formatTime(createdAtMs)}</span>
            <button
              type="button"
              className="message-copy"
              onClick={() => void copy()}
              aria-label="复制消息"
            >
              {copyState === 'copied' ? '已复制' : copyState === 'failed' ? '复制失败' : '复制'}
            </button>
            <button
              type="button"
              className="message-copy"
              onClick={saveAsNote}
              aria-label="存入记事本"
            >
              {noteState === 'saved'
                ? '已存入记事本'
                : noteState === 'failed'
                  ? '保存失败'
                  : '存入记事本'}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  )
}

/** 消息时间戳：只到分钟 */
function formatTime(createdAtMs: number): string {
  const date = new Date(createdAtMs)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function Composer(): JSX.Element {
  const activeConversationId = useAppStore((state) => state.activeConversationId)
  const streaming = useAppStore((state) => state.streaming)
  const compacting = useAppStore((state) => state.compacting)
  const sendMessage = useAppStore((state) => state.sendMessage)
  const stopGeneration = useAppStore((state) => state.stopGeneration)
  const value = useAppStore((state) => state.chatDraft)
  const setValue = useAppStore((state) => state.setChatDraft)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)

  // 从阅读器「问 AI」或发送失败带着草稿回到对话时，焦点已经落到 body，
  // 直接按 Enter 不会发送。挂载时若已有草稿就把焦点和光标放到末尾；只在挂载时执行，避免抢焦点。
  useEffect(() => {
    const draft = useAppStore.getState().chatDraft
    const input = inputRef.current
    if (!input || !draft.trim()) return
    input.focus()
    input.setSelectionRange(draft.length, draft.length)
  }, [])

  const isStreaming = streaming !== null || compacting
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
          ref={inputRef}
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
  const selectModel = useAppStore((state) => state.selectModel)

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
        searchable
        onChange={(value) => void selectModel(value)}
      />
    </div>
  )
}
