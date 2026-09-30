import { useEffect, useMemo, useState } from 'react'
import type { JSX } from 'react'

import type { NoteView } from '@shared/types'
import { useAppStore } from '../stores/app-store'
import { CloseIcon, PlusIcon } from './icons'

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  return '操作失败，请稍后重试'
}

export function NotesPage(): JSX.Element {
  const notes = useAppStore((state) => state.notes)
  const refreshNotes = useAppStore((state) => state.refreshNotes)
  const importNote = useAppStore((state) => state.importNote)
  const exportNote = useAppStore((state) => state.exportNote)
  const deleteNote = useAppStore((state) => state.deleteNote)
  const [query, setQuery] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [flash, setFlash] = useState('')

  useEffect(() => {
    void refreshNotes()
  }, [refreshNotes])

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    if (!keyword) return notes
    return notes.filter(
      (note) =>
        note.title.toLowerCase().includes(keyword) ||
        note.content.toLowerCase().includes(keyword)
    )
  }, [notes, query])

  const editingNote = notes.find((note) => note.id === editingId) ?? null

  if (editingId !== null && editingNote) {
    return (
      <NoteEditor
        note={editingNote}
        onClose={() => setEditingId(null)}
        onSaved={() => setEditingId(null)}
      />
    )
  }

  return (
    <div className="view-enter">
      <div className="toolbar-row">
        <input
          className="field-input"
          style={{ maxWidth: 320 }}
          type="text"
          placeholder="搜索标题或正文…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className="toolbar-grow" />
        {flash ? <span className="toast-inline">{flash}</span> : null}
        <button
          type="button"
          className="btn-ghost"
          onClick={() => void (async () => {
            try {
              const note = await importNote()
              if (note) setEditingId(note.id)
            } catch (error) {
              useAppStore.setState({ error: toErrorMessage(error) })
            }
          })()}
        >
          导入 .md
        </button>
        <button type="button" className="btn-gold" onClick={() => setEditingId('')}>
          <PlusIcon />
          新建笔记
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className="message-empty" style={{ minHeight: 360 }}>
          <div>
            <p className="empty-title">暂无笔记</p>
            <p className="empty-text">点右上角「新建笔记」记录第一条想法。</p>
          </div>
        </div>
      ) : (
        <div className="notes-grid">
          {filtered.map((note) => (
            <NoteCard
              key={note.id}
              note={note}
              flash={setFlash}
              onOpen={() => setEditingId(note.id)}
              onDelete={() => setConfirmId(note.id)}
              confirming={confirmId === note.id}
              onCancelDelete={() => setConfirmId(null)}
              onConfirmDelete={() => {
                setConfirmId(null)
                void (async () => {
                  try {
                    await deleteNote(note.id)
                  } catch (error) {
                    useAppStore.setState({ error: toErrorMessage(error) })
                  }
                })()
              }}
              onExport={() =>
                void (async () => {
                  try {
                    const path = await exportNote(note.id)
                    if (path) setFlash(`已导出：${path}`)
                    else setFlash('已取消导出')
                    window.setTimeout(() => setFlash(''), 1600)
                  } catch (error) {
                    useAppStore.setState({ error: toErrorMessage(error) })
                  }
                })()
              }
            />
          ))}
        </div>
      )}
    </div>
  )
}

function NoteCard({
  note,
  onOpen,
  onDelete,
  confirming,
  onCancelDelete,
  onConfirmDelete,
  onExport,
  flash
}: {
  note: NoteView
  onOpen: () => void
  onDelete: () => void
  confirming: boolean
  onCancelDelete: () => void
  onConfirmDelete: () => void
  onExport: () => void
  flash: (message: string) => void
}): JSX.Element {
  const preview = note.content.replace(/\s+/g, ' ').trim()
  return (
    <div className="glass note-card">
      <div className="note-head">
        <button type="button" className="note-title-btn" onClick={onOpen}>
          <span className="note-title">{note.title || '（无标题）'}</span>
          <span className="note-time">
            {new Date(note.updatedAtMs).toLocaleDateString()} · {preview.slice(0, 40) || '（空笔记）'}
          </span>
        </button>
        <div className="toolbar-row" style={{ gap: 4 }}>
          <button
            type="button"
            className="icon-btn"
            aria-label="导出 .md"
            onClick={onExport}
          >
            ↓
          </button>
          <button
            type="button"
            className="icon-btn danger"
            aria-label="删除笔记"
            onClick={onDelete}
          >
            ✕
          </button>
        </div>
      </div>
      {confirming ? (
        <div className="confirm-row">
          确认删除？
          <button
            type="button"
            className="btn-ghost btn-danger"
            onClick={() => {
              onConfirmDelete()
              flash('已删除')
            }}
          >
            删除
          </button>
          <button type="button" className="btn-ghost" onClick={onCancelDelete}>
            取消
          </button>
        </div>
      ) : null}
      <div className="note-preview">{preview || '（空笔记）'}</div>
    </div>
  )
}

function NoteEditor({
  note,
  onClose,
  onSaved
}: {
  note: NoteView | null
  onClose: () => void
  onSaved: () => void
}): JSX.Element {
  const [title, setTitle] = useState(note?.title ?? '')
  const [content, setContent] = useState(note?.content ?? '')
  const [saving, setSaving] = useState(false)
  const [errorText, setErrorText] = useState('')

  const submit = async (): Promise<void> => {
    if (saving) return
    if (!title.trim() && !content.trim()) {
      onClose()
      return
    }
    setSaving(true)
    try {
      await useAppStore.getState().saveNote({
        id: note?.id,
        title: title.trim() || '（无标题）',
        content
      })
      onSaved()
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="note-editor-wrap view-enter">
      <div className="glass note-editor-card">
        <div className="overlay-head-row">
          <input
            type="text"
            className="note-title-input"
            placeholder="笔记标题"
            value={title}
            aria-label="笔记标题"
            onChange={(event) => setTitle(event.target.value)}
          />
          <div className="toolbar-row" style={{ gap: 8 }}>
            <button
              type="button"
              className="btn-gold"
              disabled={saving}
              onClick={() => void submit()}
            >
              {saving ? '保存中…' : '完成'}
            </button>
            <button type="button" className="icon-btn" aria-label="关闭" onClick={onClose}>
              <CloseIcon />
            </button>
          </div>
        </div>

        {errorText ? (
          <div className="status-banner" role="alert">
            {errorText}
          </div>
        ) : null}

        <textarea
          className="note-editor-textarea"
          value={content}
          placeholder="支持 Markdown，保存后可导出 .md 文件"
          onChange={(event) => setContent(event.target.value)}
          autoFocus
        />
        <p className="field-hint">返回自动保存；标题与内容全空则不创建。</p>
      </div>
    </div>
  )
}
