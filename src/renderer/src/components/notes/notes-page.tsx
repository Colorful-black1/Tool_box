import { useEffect, useMemo, useState } from 'react'
import type { JSX } from 'react'

import type { NoteView } from '../../../../shared/types'
import { useAppStore } from '../../stores/app-store'
import { renderMarkdown } from '../../lib/markdown'

/** 记事本：列表 + 搜索 + 导入 + 编辑页（Markdown 预览 / 导出 / 删除），对应旧项目 notes 两页 */
export function NotesPage(): JSX.Element {
  const notes = useAppStore((state) => state.notes)
  const refreshNotes = useAppStore((state) => state.refreshNotes)
  const importNote = useAppStore((state) => state.importNote)
  const deleteNote = useAppStore((state) => state.deleteNote)

  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<NoteView | 'new' | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [flash, setFlash] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')

  const reload = async (): Promise<void> => {
    setLoading(true)
    setLoadError('')
    try {
      await refreshNotes()
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    if (!keyword) return notes
    return notes.filter(
      (note) =>
        note.title.toLowerCase().includes(keyword) ||
        note.content.toLowerCase().includes(keyword)
    )
  }, [notes, query])

  function toast(message: string): void {
    setFlash(message)
    window.setTimeout(() => setFlash(''), 1600)
  }

  if (editing !== null) {
    return (
      <NoteEditor
        note={editing === 'new' ? null : editing}
        onClose={() => setEditing(null)}
        onSaved={async () => {
          setEditing(null)
          await reload()
        }}
      />
    )
  }

  if (loading) {
    return (
      <div className="view-enter">
        <div className="loading-skeleton" />
        <div className="loading-skeleton" />
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="view-enter message-empty">
        <div>
          <p className="empty-text">加载失败：{loadError}</p>
          <button type="button" className="btn-ghost" onClick={() => void reload()}>
            重试
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="view-enter notes-page">
      <div className="toolbar-row">
        <input
          className="field-input toolbar-search"
          type="text"
          placeholder="搜索标题或正文"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className="toolbar-grow" />
        {flash ? <span className="toast-inline">{flash}</span> : null}
        <button
          type="button"
          className="btn-ghost"
          onClick={() =>
            void (async () => {
              const note = await importNote()
              if (note) setEditing(note)
            })()
          }
        >
          导入 .md
        </button>
        <button type="button" className="btn-gold" onClick={() => setEditing('new')}>
          ＋ 新建笔记
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className="message-empty">
          <p className="empty-text">
            {query.trim()
              ? `没有匹配「${query.trim()}」的笔记`
              : '暂无笔记，点右上角 + 新建'}
          </p>
        </div>
      ) : (
        <ul className="notes-list">
          {filtered.map((note) => (
            <li key={note.id}>
              {confirmId === note.id ? (
                <div className="glass note-row confirming">
                  <span>
                    确定删除「{note.title || '无标题'}」吗？该操作不可恢复。
                  </span>
                  <button
                    type="button"
                    className="btn-ghost btn-danger"
                    onClick={() => {
                      setConfirmId(null)
                      void (async () => {
                        await deleteNote(note.id)
                        toast('已删除')
                      })()
                    }}
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
              ) : (
                <div
                  className="glass note-row"
                  onContextMenu={(event) => {
                    event.preventDefault()
                    setConfirmId(note.id)
                  }}
                  title="右键删除"
                >
                  <button
                    type="button"
                    className="note-row-main"
                    onClick={() => setEditing(note)}
                  >
                    <span className="note-row-title">{note.title || '（无标题）'}</span>
                    <span className="note-row-preview">
                      {note.content.replace(/\s+/g, ' ').trim() || '（空笔记）'}
                    </span>
                  </button>
                  <span className="note-row-time">{formatNoteTime(note.updatedAtMs)}</span>
                  <button
                    type="button"
                    className="btn-ghost btn-danger note-row-delete"
                    aria-label={`删除 ${note.title || '无标题'}`}
                    onClick={() => setConfirmId(note.id)}
                  >
                    删除
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

const EDITOR_PLACEHOLDER =
  '支持 Markdown：\n# 一级标题\n- 列表项\n**加粗** *斜体*\n`行内代码`'

function NoteEditor(props: {
  note: NoteView | null
  onClose(): void
  onSaved(): Promise<void>
}): JSX.Element {
  const saveNote = useAppStore((state) => state.saveNote)
  const exportNote = useAppStore((state) => state.exportNote)
  const deleteNote = useAppStore((state) => state.deleteNote)

  const [title, setTitle] = useState(props.note?.title ?? '')
  const [content, setContent] = useState(props.note?.content ?? '')
  const [preview, setPreview] = useState(false)
  const [saving, setSaving] = useState(false)
  const [flash, setFlash] = useState('')
  const [dirty, setDirty] = useState(false)

  const html = useMemo(
    () => (preview ? renderMarkdown(content) : ''),
    [preview, content]
  )

  async function finish(): Promise<void> {
    if (saving) return
    if (!title.trim() && !content.trim()) {
      props.onClose()
      return
    }
    if (props.note && !dirty) {
      props.onClose()
      return
    }
    setSaving(true)
    try {
      await saveNote({
        id: props.note?.id,
        title: title.trim() || '（无标题）',
        content
      })
      await props.onSaved()
    } catch (error) {
      setFlash(error instanceof Error ? error.message : '保存失败')
      setSaving(false)
    }
  }

  async function handleExport(): Promise<void> {
    if (!props.note) return
    const path = await exportNote(props.note.id)
    setFlash(path ? '已导出' : '已取消导出')
  }

  async function handleDelete(): Promise<void> {
    if (!props.note) return
    if (!window.confirm('确定删除该笔记吗？该操作不可恢复。')) return
    await deleteNote(props.note.id)
    await props.onSaved()
  }

  return (
    <div className="view-enter note-editor-page">
      <div className="toolbar-row">
        <button type="button" className="btn-ghost" onClick={() => void finish()}>
          ← 返回
        </button>
        <input
          className="field-input note-title-input"
          type="text"
          placeholder="笔记标题"
          value={title}
          maxLength={60}
          onChange={(event) => {
            setTitle(event.target.value)
            setDirty(true)
          }}
        />
        {flash ? <span className="toast-inline">{flash}</span> : null}
        <button
          type="button"
          className="btn-ghost"
          aria-label={preview ? '切换到编辑' : '切换到预览'}
          onClick={() => setPreview((value) => !value)}
        >
          {preview ? '编辑' : '预览'}
        </button>
        {props.note ? (
          <>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => void handleExport()}
            >
              导出 .md
            </button>
            <button
              type="button"
              className="btn-ghost btn-danger"
              onClick={() => void handleDelete()}
            >
              删除
            </button>
          </>
        ) : null}
        <button
          type="button"
          className="btn-gold"
          disabled={saving}
          onClick={() => void finish()}
        >
          {saving ? '保存中…' : '完成'}
        </button>
      </div>

      {preview ? (
        <div className="glass note-preview-pane">
          <h2 className="note-preview-title">{title || '（无标题）'}</h2>
          <div
            className="markdown-body"
            // 内容来自本地笔记，渲染前已做 HTML 转义，仅允许受控标签
            dangerouslySetInnerHTML={{ __html: html }}
          />
        </div>
      ) : (
        <textarea
          className="field-input note-body-input"
          placeholder={EDITOR_PLACEHOLDER}
          value={content}
          onChange={(event) => {
            setContent(event.target.value)
            setDirty(true)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') void finish()
            if ((event.ctrlKey || event.metaKey) && event.key === 's') {
              event.preventDefault()
              void finish()
            }
          }}
          autoFocus
        />
      )}
    </div>
  )
}

/** 同年 MM/DD，跨年 YYYY/MM/DD */
function formatNoteTime(ms: number): string {
  const date = new Date(ms)
  const now = new Date()
  const pad = (value: number): string => String(value).padStart(2, '0')
  const md = `${pad(date.getMonth() + 1)}/${pad(date.getDate())}`
  return date.getFullYear() === now.getFullYear() ? md : `${date.getFullYear()}/${md}`
}