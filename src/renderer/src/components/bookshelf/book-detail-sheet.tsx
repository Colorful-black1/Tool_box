import { useModalFocus } from '../../lib/use-modal-focus'
import { useRef, useState } from 'react'
import type { JSX } from 'react'

import type { BookSummary } from '../../../../shared/types'
import { useOverlayEscape } from '../../lib/use-overlay-dismiss'
import { useAppStore } from '../../stores/app-store'

interface BookDetailSheetProps {
  book: BookSummary
  onClose(): void
  onSaved(): Promise<void>
}

/** 书籍详情弹层：封面预览 + 元信息 + 改名/改作者，对应旧项目 book_detail_sheet.dart */
export function BookDetailSheet({
  book,
  onClose,
  onSaved
}: BookDetailSheetProps): JSX.Element {
  const updateBookMeta = useAppStore((state) => state.updateBookMeta)
  const [title, setTitle] = useState(book.title)
  const [author, setAuthor] = useState(book.author)
  const [saving, setSaving] = useState(false)

  const modalRef = useRef<HTMLDivElement>(null)
  useModalFocus(modalRef)
  useOverlayEscape(onClose)

  async function save(): Promise<void> {
    const nextTitle = title.trim()
    if (!nextTitle) return
    setSaving(true)
    try {
      await updateBookMeta(book.id, { title: nextTitle, author })
      await onSaved()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="overlay"
      ref={modalRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label="书籍详情"
      onClick={onClose}
    >
      <div className="glass overlay-card book-detail" onClick={(event) => event.stopPropagation()}>
        <div className="book-detail-cover">
          {book.coverPath ? (
            <img
              src={`file:///${book.coverPath.replaceAll('\\', '/')}`}
              alt={book.title}
            />
          ) : (
            <div className="cover-art" />
          )}
        </div>

        <div className="book-detail-info">
          <div className="book-detail-row">
            <span className="book-detail-label">章节</span>
            <span>{book.chapterCount} 章</span>
          </div>
          <div className="book-detail-row">
            <span className="book-detail-label">添加时间</span>
            <span>{new Date(book.createdAtMs).toISOString().slice(0, 10)}</span>
          </div>
          <div className="book-detail-row">
            <span className="book-detail-label">阅读进度</span>
            <span>
              {book.progress
                ? `阅读进度：${(book.progress.percent * 100).toFixed(1)}%`
                : '尚未开始阅读'}
            </span>
          </div>
        </div>

        <div className="settings-grid">
          <div>
            <label className="field-label" htmlFor="book-title">
              书名
            </label>
            <input
              id="book-title"
              className="field-input"
              value={title}
              maxLength={60}
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>
          <div>
            <label className="field-label" htmlFor="book-author">
              作者
            </label>
            <input
              id="book-author"
              className="field-input"
              value={author}
              maxLength={30}
              placeholder="可留空"
              onChange={(event) => setAuthor(event.target.value)}
            />
          </div>
          <div className="overlay-actions">
            <button type="button" className="btn-ghost" onClick={onClose}>
              取消
            </button>
            <button
              type="button"
              className="btn-gold"
              disabled={saving || !title.trim()}
              onClick={() => void save()}
            >
              {saving ? '保存中…' : '保存'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}