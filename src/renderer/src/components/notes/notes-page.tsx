import { confirmDialog } from '../../stores/dialog-store'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { JSX, KeyboardEvent } from 'react'

import type { NoteView } from '../../../../shared/types'
import { useAppStore } from '../../stores/app-store'
import { renderMarkdown } from '../../lib/markdown'

/** 记事本：列表 + 搜索 + 导入 + 编辑页（Markdown 预览 / 导出 / 删除），对应旧项目 notes 两页 */
export function NotesPage(): JSX.Element {
  const notes = useAppStore((state) => state.notes)
  const refreshNotes = useAppStore((state) => state.refreshNotes)
  const importNote = useAppStore((state) => state.importNote)
  const deleteNote = useAppStore((state) => state.deleteNote)
  const searchTarget = useAppStore((state) => state.searchTarget)
  const clearSearchTarget = useAppStore((state) => state.clearSearchTarget)

  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<NoteView | 'new' | null>(null)
  const [searchRevision, setSearchRevision] = useState(0)
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

  useEffect(() => {
    if (loading || loadError || searchTarget?.kind !== 'note') return
    const note = notes.find((item) => item.id === searchTarget.id)
    if (note) {
      setEditing(note)
      // 同一条目再次命中也需重建编辑器，兑现命令面板中已确认的放弃草稿操作。
      setSearchRevision((revision) => revision + 1)
    } else {
      setFlash('该笔记已不存在，请重新搜索')
    }
    clearSearchTarget()
  }, [loading, loadError, searchTarget, notes, clearSearchTarget])

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
        key={`${editing === 'new' ? 'new' : editing.id}-${searchRevision}`}
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
  const setUnsavedChanges = useAppStore((state) => state.setUnsavedChanges)

  const [title, setTitle] = useState(props.note?.title ?? '')
  const [content, setContent] = useState(props.note?.content ?? '')
  const [preview, setPreview] = useState(false)
  const [saving, setSaving] = useState(false)
  const [flash, setFlash] = useState('')
  const [dirty, setDirty] = useState(false)
  // 保存后仍留在编辑页，后续保存必须继续更新同一条笔记，而不是再建一条。
  const [noteId, setNoteId] = useState<string | null>(props.note?.id ?? null)
  const source = useRef<HTMLTextAreaElement>(null)
  const rendered = useRef<HTMLDivElement>(null)
  const syncing = useRef(false)

  useEffect(() => {
    setUnsavedChanges(dirty)
    return () => setUnsavedChanges(false)
  }, [dirty, setUnsavedChanges])

  const html = useMemo(
    () => (preview ? renderMarkdown(content) : ''),
    [preview, content]
  )

  /** 保存但不离开编辑页；返回值和提示分开，供保存按钮与返回按钮复用。 */
  async function persist(): Promise<'saved' | 'empty' | 'unchanged' | 'failed'> {
    if (!title.trim() && !content.trim()) return 'empty'
    if (noteId && !dirty) return 'unchanged'
    setSaving(true)
    try {
      const saved = await saveNote({
        id: noteId ?? undefined,
        title: title.trim() || '（无标题）',
        content
      })
      setNoteId(saved.id)
      setTitle(saved.title)
      setDirty(false)
      setFlash('已保存')
      return 'saved'
    } catch (error) {
      setFlash(error instanceof Error ? error.message : '保存失败')
      return 'failed'
    } finally {
      setSaving(false)
    }
  }

  async function handleSave(): Promise<void> {
    if (saving) return
    const outcome = await persist()
    if (outcome === 'empty') setFlash('请先输入标题或正文')
    else if (outcome === 'unchanged') setFlash('没有需要保存的修改')
  }

  /** 只有「返回」会离开编辑页；返回时若保存成功则同步刷新列表。 */
  async function finish(): Promise<void> {
    if (saving) return
    if (!title.trim() && !content.trim()) {
      props.onClose()
      return
    }
    if (noteId && !dirty) {
      props.onClose()
      return
    }
    const outcome = await persist()
    if (outcome === 'saved' || outcome === 'unchanged') await props.onSaved()
  }

  async function handleExport(): Promise<void> {
    if (!noteId) return
    const path = await exportNote(noteId)
    setFlash(path ? '已导出' : '已取消导出')
  }

  async function handleDelete(): Promise<void> {
    if (!noteId) return
    if (!(await confirmDialog('确定删除该笔记吗？该操作不可恢复。'))) return
    await deleteNote(noteId)
    await props.onSaved()
  }

  function handleEditorKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if ((event.ctrlKey || event.metaKey) && event.key === 's') {
      event.preventDefault()
      void handleSave()
    }
  }

  /** 两侧滚动条按比例联动；程序设置 scrollTop 时用 syncing 防止互相触发。 */
  function syncScroll(from: HTMLElement | null, to: HTMLElement | null): void {
    if (!from || !to || syncing.current) return
    const fromMax = from.scrollHeight - from.clientHeight
    const toMax = to.scrollHeight - to.clientHeight
    if (fromMax <= 0 || toMax <= 0) return
    const top = (from.scrollTop / fromMax) * toMax
    if (Math.abs(to.scrollTop - top) < 1) return
    syncing.current = true
    to.scrollTop = top
    window.requestAnimationFrame(() => {
      syncing.current = false
    })
  }

  return (
    <div className="view-enter note-editor-page" onKeyDown={handleEditorKeyDown}>
      <div className="toolbar-row">
        <button type="button" className="btn-ghost" onClick={() => void finish()}>
          ← 返回
        </button>
        <input
          className="field-input note-title-input"
          type="text"
          placeholder="笔记标题"
          aria-label="笔记标题"
          value={title}
          maxLength={60}
          onChange={(event) => {
            setTitle(event.target.value)
            setDirty(true)
            setFlash('')
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
        {noteId ? (
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
          onClick={() => void handleSave()}
        >
          {saving ? '保存中…' : '保存'}
        </button>
      </div>

      {preview ? (
        <div className="note-split">
          <section className="glass note-split-pane" aria-label="原文">
            <header className="note-split-head">原文</header>
            <textarea
              ref={source}
              className="field-input note-body-input note-split-input"
              placeholder={EDITOR_PLACEHOLDER}
              aria-label="笔记原文"
              value={content}
              onChange={(event) => {
                setContent(event.target.value)
                setDirty(true)
                setFlash('')
              }}
              onScroll={() => syncScroll(source.current, rendered.current)}
            />
          </section>
          <section className="glass note-split-pane" aria-label="Markdown 预览">
            <header className="note-split-head">Markdown 预览</header>
            <div
              ref={rendered}
              className="note-preview-pane"
              onScroll={() => syncScroll(rendered.current, source.current)}
            >
              <h2 className="note-preview-title">{title || '（无标题）'}</h2>
              <div
                className="markdown-body"
                // 内容来自本地笔记，渲染前已做 HTML 转义，仅允许受控标签
                dangerouslySetInnerHTML={{ __html: html }}
              />
            </div>
          </section>
        </div>
      ) : (
        <textarea
          className="field-input note-body-input"
          placeholder={EDITOR_PLACEHOLDER}
          aria-label="笔记正文"
          value={content}
          onChange={(event) => {
            setContent(event.target.value)
            setDirty(true)
            setFlash('')
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
