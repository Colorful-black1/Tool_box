import { useEffect, useMemo, useState } from 'react'
import type { JSX } from 'react'

import type { ChapterMeta, ReaderTheme } from '../../../../shared/types'
import { searchChapters } from '../../lib/paginator'

interface SearchSheetProps {
  bookId: string
  chapters: ChapterMeta[]
  theme: ReaderTheme
  onClose(): void
  onSelect(chapterIdx: number, ratio: number): void
}

/** 书内搜索：300ms 防抖 + 全书大小写不敏感扫描，对应旧项目 search_sheet.dart */
export function SearchSheet(props: SearchSheetProps): JSX.Element {
  const { chapters, theme } = props
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const [typing, setTyping] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [contents, setContents] = useState<Record<number, string>>({})

  useEffect(() => {
    if (!query.trim()) {
      setDebounced('')
      setTyping(false)
      return
    }
    setTyping(true)
    const timer = window.setTimeout(() => {
      setDebounced(query)
      setTyping(false)
    }, 300)
    return () => window.clearTimeout(timer)
  }, [query])

  // 仅在确定关键词后拉取全部章节正文
  useEffect(() => {
    const keyword = debounced.trim()
    if (!keyword) return
    let cancelled = false
    setScanning(true)

    void (async () => {
      const bridge = window.toolbox
      if (!bridge) return
      const next: Record<number, string> = {}
      for (const chapter of chapters) {
        if (cancelled) return
        const content = await bridge.books.chapterContent(chapter.id)
        next[chapter.idx] = content.content
      }
      if (!cancelled) {
        setContents(next)
        setScanning(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [debounced, chapters])

  const { hits, truncated } = useMemo(() => {
    const keyword = debounced.trim()
    if (!keyword) return { hits: [], truncated: false }
    const inputs = chapters.map((chapter) => ({
      idx: chapter.idx,
      title: chapter.title,
      content: contents[chapter.idx] ?? ''
    }))
    return searchChapters(inputs, keyword, 200)
  }, [chapters, contents, debounced])

  const loadedCount = Object.keys(contents).length
  const ready = !debounced.trim() || (loadedCount >= chapters.length && !scanning)

  let summary: string
  if (!query.trim()) summary = '输入关键词搜索全书'
  else if (typing || scanning || !ready) summary = '搜索中…'
  else if (hits.length === 0) summary = `没有找到「${debounced.trim()}」`
  else summary = `共 ${hits.length} 条结果${truncated ? '（已达上限）' : ''}`

  return (
    <div className="sheet-backdrop" onClick={props.onClose} role="presentation">
      <div
        className="sheet-panel search-sheet"
        style={{ background: theme.background, color: theme.foreground }}
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-label="书内搜索"
      >
        <div className="sheet-tabs">
          <span className="sheet-tab active static">书内搜索</span>
          <button
            type="button"
            className="sheet-close"
            aria-label="关闭"
            onClick={props.onClose}
          >
            ✕
          </button>
        </div>

        <div className="sheet-toolbar">
          <input
            className="field-input"
            type="text"
            autoFocus
            placeholder="输入关键词搜索全书"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                setDebounced(query)
                setTyping(false)
              }
            }}
          />
        </div>

        <div className="sheet-summary">{summary}</div>

        <div className="sheet-scroll">
          <ul className="search-list">
            {hits.map((hit, index) => (
              <li key={`${hit.chapterIdx}-${index}`}>
                <button
                  type="button"
                  className="search-item"
                  onClick={() => props.onSelect(hit.chapterIdx, hit.ratio)}
                >
                  <span className="search-item-text">
                    {hit.before}
                    <mark>{hit.match}</mark>
                    {hit.after}
                  </span>
                  <span className="search-item-chapter">{hit.chapterTitle}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}