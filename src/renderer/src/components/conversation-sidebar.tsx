import { useState } from 'react'
import type { JSX } from 'react'

import type { ConversationSummary } from '@shared/types'
import { useAppStore } from '../stores/app-store'
import { CheckIcon, CloseIcon, EditIcon, PlusIcon, TrashIcon } from './icons'

export function ConversationSidebar(): JSX.Element {
  const conversations = useAppStore((state) => state.conversations)
  const activeConversationId = useAppStore((state) => state.activeConversationId)
  const createConversation = useAppStore((state) => state.createConversation)
  const renameConversation = useAppStore((state) => state.renameConversation)
  const deleteConversation = useAppStore((state) => state.deleteConversation)
  const selectConversation = useAppStore((state) => state.selectConversation)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [draftTitle, setDraftTitle] = useState('')
  const [confirmId, setConfirmId] = useState<string | null>(null)

  const startEdit = (conversation: ConversationSummary): void => {
    setConfirmId(null)
    setEditingId(conversation.id)
    setDraftTitle(conversation.title)
  }

  const cancelEdit = (): void => {
    setEditingId(null)
    setDraftTitle('')
  }

  const submitEdit = async (): Promise<void> => {
    if (!editingId) return
    const title = draftTitle.trim()
    if (!title) return
    try {
      await renameConversation(editingId, title)
      cancelEdit()
    } catch (error) {
      useAppStore.setState({ error: toErrorMessage(error) })
    }
  }

  const confirmDelete = async (id: string): Promise<void> => {
    setConfirmId(null)
    try {
      await deleteConversation(id)
    } catch (error) {
      useAppStore.setState({ error: toErrorMessage(error) })
    }
  }

  const handleCreate = async (): Promise<void> => {
    try {
      await createConversation()
    } catch (error) {
      useAppStore.setState({ error: toErrorMessage(error) })
    }
  }

  return (
    <aside className="glass conversation-panel" aria-label="会话列表">
      <div className="panel-head">
        <h2 className="panel-title">会话星图</h2>
        <button type="button" className="btn-gold" onClick={() => void handleCreate()}>
          <PlusIcon />
          新对话
        </button>
      </div>

      <div className="conversation-list">
        {conversations.length === 0 ? (
          <div className="message-empty">
            <p className="empty-text">暂无会话</p>
          </div>
        ) : (
          <ul className="list-none p-0 m-0">
            {conversations.map((conversation) => {
              const isActive = conversation.id === activeConversationId
              return (
                <li
                  key={conversation.id}
                  className={`conversation-item${isActive ? ' active' : ''}`}
                >
                  {editingId === conversation.id ? (
                    <form
                      className="rename-form"
                      onSubmit={(event) => {
                        event.preventDefault()
                        void submitEdit()
                      }}
                    >
                      <input
                        className="rename-input"
                        value={draftTitle}
                        maxLength={60}
                        aria-label="会话标题"
                        onChange={(event) => setDraftTitle(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Escape') cancelEdit()
                        }}
                        autoFocus
                      />
                      <button
                        type="submit"
                        className="icon-btn"
                        aria-label="保存标题"
                      >
                        <CheckIcon />
                      </button>
                      <button
                        type="button"
                        className="icon-btn"
                        aria-label="取消编辑"
                        onClick={cancelEdit}
                      >
                        <CloseIcon />
                      </button>
                    </form>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="conversation-main"
                        onClick={() => void selectConversation(conversation.id)}
                      >
                        <span className="conversation-title">{conversation.title}</span>
                        <span className="conversation-meta">
                          {formatTime(conversation.updatedAtMs)} · {conversation.messageCount} 条
                        </span>
                      </button>
                      <div className="conversation-actions">
                        <button
                          type="button"
                          className="icon-btn"
                          aria-label={`重命名 ${conversation.title}`}
                          onClick={() => startEdit(conversation)}
                        >
                          <EditIcon />
                        </button>
                        <button
                          type="button"
                          className="icon-btn danger"
                          aria-label={`删除 ${conversation.title}`}
                          onClick={() => setConfirmId(conversation.id)}
                        >
                          <TrashIcon />
                        </button>
                      </div>
                      {confirmId === conversation.id ? (
                        <div className="confirm-row">
                          <span>确认删除？</span>
                          <button
                            type="button"
                            className="btn-ghost btn-danger"
                            onClick={() => void confirmDelete(conversation.id)}
                          >
                            删除
                          </button>
                          <button
                            type="button"
                            className="btn-ghost"
                            onClick={() => setConfirmId(null)}
                          >
                            取消
                          </button>
                        </div>
                      ) : null}
                    </>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </aside>
  )
}

function formatTime(timestampMs: number): string {
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(new Date(timestampMs))
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  return '操作失败，请稍后重试'
}
