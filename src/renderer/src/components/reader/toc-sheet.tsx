import { useMemo, useState } from 'react'
import type { JSX } from 'react'

import type { Bookmark, ChapterMeta, ReaderTheme } from '../../../../shared/types'

interface TocSheetProps {
  chapters: ChapterMeta[]
  bookmarks: Bookmark[]
  currentChapterIdx: number
  theme: ReaderTheme
  onClose(): void
  onSelectChapter(idx: number): void
  onSelectBookmark(bookmark: Bookmark): void
  onDeleteBookmark(id: string): void
}

/** 目录抽屉：双 Tab（目录 / 书签）+ 章节搜索 + 正倒序切换，对应旧项目 toc_sheet.dart */
export function TocSheet(props: TocSheetProps): JSX.Element {
  const { chapters, bookmarks, theme } = props
  const [tab, setTab] = useState<'toc' | 'marks'>('toc')
  const [query, setQuery] = useState('')
  const [descending, setDescending] = useState(false)
  const [confirmId, setConfirmId] = useState<string | null>(null)

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    const list = keyword
      ? chapters.filter((chapter) => chapter.title.toLowerCase().includes(keyword))
      : chapters
    return descending ? [...list].reverse() : list
  }, [chapters, query, descending])

  return (
    <div className="sheet-backdrop" onClick={props.onClose} role="presentation">
      <div
        className="sheet-panel toc-sheet"
        style={{ background: theme.background, color: theme.foreground }}
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-label="目录"
      >
        <div className="sheet-tabs">
          <button
            type="button"
            className={`sheet-tab${tab === 'toc' ? ' active' : ''}`}
            onClick={() => setTab('toc')}
          >
            目录
          </button>
          <button
            type="button"
            className={`sheet-tab${tab === 'marks' ? ' active' : ''}`}
            onClick={() => setTab('marks')}
          >
            书签
          </button>
          <button
            type="button"
            className="sheet-close"
            aria-label="关闭"
            onClick={props.onClose}
          >
            ✕
          </button>
        </div>

        {tab === 'toc' ? (
          <>
            <div className="sheet-toolbar">
              <input
                className="field-input"
                type="text"
                placeholder="搜索章节标题…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              <button
                type="button"
                className="btn-ghost"
                onClick={() => setDescending((value) => !value)}
              >
                {descending ? '正序' : '倒序'}
              </button>
            </div>

            <div className="sheet-scroll">
              {filtered.length === 0 ? (
                <p className="sheet-empty">
                  {query ? '没有匹配的章节' : '暂无章节'}
                </p>
              ) : (
                <ul className="toc-list">
                  {filtered.map((chapter) => (
                    <li key={chapter.id}>
                      <button
                        type="button"
                        className={`toc-item${
                          chapter.idx === props.currentChapterIdx ? ' active' : ''
                        }`}
                        onClick={() => props.onSelectChapter(chapter.idx)}
                      >
                        {chapter.title}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="sheet-footer-hint">共 {chapters.length} 章</div>
          </>
        ) : (
          <div className="sheet-scroll">
            {bookmarks.length === 0 ? (
              <p className="sheet-empty">
                暂无书签
                <br />
                打开菜单点击书签按钮即可收藏当前页
              </p>
            ) : (
              <ul className="toc-list">
                {bookmarks.map((bookmark) => {
                  const chapter = chapters[bookmark.chapterIdx]
                  const chapterName = chapter?.title ?? `第${bookmark.chapterIdx + 1}章`
                  return (
                    <li key={bookmark.id}>
                      {confirmId === bookmark.id ? (
                        <div className="confirm-row">
                          确定删除「{chapterName}」处的书签吗？
                          <button
                            type="button"
                            className="btn-ghost btn-danger"
                            onClick={() => {
                              props.onDeleteBookmark(bookmark.id)
                              setConfirmId(null)
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
                        <button
                          type="button"
                          className="toc-item bookmark"
                          onClick={() => props.onSelectBookmark(bookmark)}
                          onContextMenu={(event) => {
                            event.preventDefault()
                            setConfirmId(bookmark.id)
                          }}
                          title="右键删除书签"
                        >
                          <span className="toc-item-title">{chapterName}</span>
                          <span className="toc-item-sub">
                            {bookmark.snippet || '（无摘录）'}
                          </span>
                        </button>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  )
}