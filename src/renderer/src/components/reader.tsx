import { useEffect, useState } from 'react'
import type { JSX } from 'react'

import type { BookSummary, ChapterContent } from '@shared/types'
import { useAppStore } from '../stores/app-store'
import { TrashIcon } from './icons'

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  return '操作失败，请稍后重试'
}

export function ReaderPage(): JSX.Element {
  const books = useAppStore((state) => state.books)
  const refreshBooks = useAppStore((state) => state.refreshBooks)
  const importBook = useAppStore((state) => state.importBook)
  const openReader = useAppStore((state) => state.openReader)
  const deleteBook = useAppStore((state) => state.deleteBook)
  const [query, setQuery] = useState('')

  useEffect(() => {
    void refreshBooks()
  }, [refreshBooks])

  const filtered = query
    ? books.filter((book) => book.title.toLowerCase().includes(query.toLowerCase()))
    : books

  return (
    <div className="view-enter">
      <div className="toolbar-row">
        <input
          className="field-input"
          style={{ maxWidth: 320 }}
          type="text"
          placeholder="搜索书名…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className="toolbar-grow" />
        <button type="button" className="btn-gold" onClick={() => void importBook()}>
          导入 TXT
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className="message-empty" style={{ minHeight: 360 }}>
          <div>
            <p className="empty-title">书架空空如也</p>
            <p className="empty-text">导入一份 TXT 小说，开始你的星光阅读之旅。</p>
          </div>
        </div>
      ) : (
        <div className="shelf-grid">
          {filtered.map((book) => (
            <BookCard key={book.id} book={book} />
          ))}
        </div>
      )}
    </div>
  )

  function BookCard({ book }: { book: BookSummary }): JSX.Element {
    const [confirming, setConfirming] = useState(false)
    const progressLabel = book.progress
      ? `读至第 ${book.progress.chapterIdx + 1} 章`
      : '尚未开始'
    const ratio = book.progress
      ? Math.round((book.progress.offsetRatio * 100))
      : 0

    return (
      <div className="glass book-card-box">
        <button type="button" className="book-main" onClick={() => void openReader(book.id)}>
          <div className="book-spine" aria-hidden="true">
            <span className="book-spine-title">{book.title.slice(0, 12)}</span>
          </div>
          <div className="book-info">
            <div className="book-card-title">{book.title}</div>
            <div className="book-progress-outer">
              <div className="book-progress-inner" style={{ width: `${ratio}%` }} />
            </div>
            <div className="book-sub">
              {book.chapterCount} 章 · {progressLabel}
            </div>
          </div>
        </button>

        {confirming ? (
          <div className="confirm-row">
            <span>删除此书？</span>
            <button
              type="button"
              className="btn-ghost btn-danger"
              onClick={() => {
                setConfirming(false)
                void (async () => {
                  try {
                    await deleteBook(book.id)
                  } catch (error) {
                    useAppStore.setState({ error: toErrorMessage(error) })
                  }
                })()
              }}
            >
              删除
            </button>
            <button type="button" className="btn-ghost" onClick={() => setConfirming(false)}>
              取消
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="icon-btn book-danger"
            aria-label={`删除 ${book.title}`}
            onClick={() => setConfirming(true)}
          >
            <TrashIcon />
          </button>
        )}
      </div>
    )
  }
}

export function ReadingView(): JSX.Element {
  const books = useAppStore((state) => state.books)
  const activeBookId = useAppStore((state) => state.activeBookId)
  const chapters = useAppStore((state) => state.chapters)
  const chapter = useAppStore((state) => state.chapterContent)
  const loadBook = useAppStore((state) => state.loadBook)
  const gotoChapter = useAppStore((state) => state.gotoChapter)

  const activeBook = books.find((item) => item.id === activeBookId) ?? null

  useEffect(() => {
    if (activeBookId) void loadBook(activeBookId)
  }, [activeBookId, loadBook])

  if (!activeBook) {
    return (
      <div className="message-empty" style={{ minHeight: 300 }}>
        <div>
          <p className="empty-text">没有打开的书，请从书架选择。</p>
        </div>
      </div>
    )
  }

  return (
    <div className="reader-wrap view-enter">
      <div className="reader-page">
        <div className="rp-chapter">{chapter?.title ?? '加载中…'}</div>
        <div className="rp-divider">✦ ✦ ✦</div>
        <div className="rp-body">
          {chapterLines(chapter).map((line, index) => (
            <p key={index}>{line}</p>
          ))}
        </div>
      </div>

      <aside className="reader-tools">
        <div className="glass tool-card">
          <div className="toolbar-row" style={{ gap: 8 }}>
              <button
                type="button"
                className="btn-ghost"
                onClick={() => useAppStore.getState().closeReader()}>
              ← 返回书架
            </button>
          </div>
          <div className="reader-nav-row">
            <button
              type="button"
              className="btn-ghost"
              disabled={!chapter || chapter.idx <= 0}
              onClick={() => void gotoChapter((chapter?.idx ?? 0) - 1)}
            >
              上一章
            </button>
            <button
              type="button"
              className="btn-ghost"
              disabled={!chapter || chapter.idx >= chapters.length - 1}
              onClick={() => void gotoChapter((chapter?.idx ?? 0) + 1)}
            >
              下一章
            </button>
          </div>
        </div>

        <div className="glass chapter-list-card">
          <div className="chapter-list-head">✦ 目录 · {activeBook.title}</div>
          <div className="chapter-list">
            {chapters.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`ch-item-btn${chapter?.idx === item.idx ? ' on' : ''}`}
                onClick={() => void gotoChapter(item.idx)}
              >
                {item.title}
              </button>
            ))}
          </div>
        </div>
      </aside>
    </div>
  )
}

function chapterLines(content: ChapterContent | null): string[] {
  if (!content) return ['正在加载…']
  const body = content.content.trim()
  if (!body) return ['（本章为空）']
  return body
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
}
