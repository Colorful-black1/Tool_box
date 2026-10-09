import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, JSX } from 'react'

import { READER_PADDING_H, READER_PADDING_V } from '../../../../shared/constants'
import { effectiveReaderTheme } from '../../../../shared/types'
import type { Bookmark, ChapterContent, ChapterMeta } from '../../../../shared/types'
import { paginate } from '../../lib/paginator'
import { useConfigStore } from '../../stores/config-store'
import { useReaderStore } from '../../stores/reader-store'
import { ReadSettingsPanel } from './read-settings-panel'
import { ReaderMenu } from './reader-menu'
import { SearchSheet } from './search-sheet'
import { TocSheet } from './toc-sheet'

export interface ReaderProps {
  bookId: string
  bookTitle: string
  onBack: () => void
}

/**
 * 阅读器：对应旧项目 reader_page.dart + reader_menu.dart。
 * 布局 = 顶部浮层菜单 + 正文区分页/滚动 + 目录抽屉 + 书内搜索 + 阅读设置面板。
 */
export function Reader({ bookId, bookTitle, onBack }: ReaderProps): JSX.Element {
  // 只订阅需要的字段：整店订阅会在每次 setState 时返回新对象，
  // 导致依赖 store 的 useCallback / useEffect 反复重建并触发渲染循环。
  const chapters = useReaderStore((state) => state.chapters)
  const chapter = useReaderStore((state) => state.chapter)
  const chapterIdx = useReaderStore((state) => state.chapterIdx)
  const pageIdx = useReaderStore((state) => state.pageIdx)
  const bookmarks = useReaderStore((state) => state.bookmarks)
  const bookPercent = useReaderStore((state) => state.bookPercent)

  const liveConfig = useConfigStore((state) => state.config)

  const config = liveConfig
  const theme = effectiveReaderTheme(config)

  const [menuVisible, setMenuVisible] = useState(true)
  const [tocOpen, setTocOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [pageHeight, setPageHeight] = useState(800)

  const viewportRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const [pageCount, setPageCount] = useState(1)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')

    void (async () => {
      try {
        await useReaderStore.getState().loadBook(bookId)
        if (!cancelled) setLoading(false)
      } catch (loadError) {
        if (!cancelled) {
          setError(
            `加载失败：${loadError instanceof Error ? loadError.message : String(loadError)}\n请检查原 TXT 文件是否仍存在。`
          )
          setLoading(false)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [bookId])

  // 分页测量：整章渲染一次，测 scrollHeight，按可视高度切页
  const measure = useCallback(() => {
    const viewport = viewportRef.current
    const content = contentRef.current
    if (!viewport || !content) return

    const height = viewport.clientHeight
    setPageHeight(height)

    if (config.pageMode === 'scroll') {
      setPageCount(1)
      useReaderStore.getState().setPagination(1, [0])
      return
    }

    const result = paginate(content.scrollHeight, height)
    setPageCount(result.pageCount)
    useReaderStore.getState().setPagination(result.pageCount, result.pageOffsets)
  }, [config.pageMode])

  useEffect(() => {
    // 文本渲染完成后高度才确定，下一帧再测一次
    const raf = requestAnimationFrame(() => measure())
    measure()
    return () => cancelAnimationFrame(raf)
  }, [measure, chapter?.id, config.fontSize, config.lineSpacing, config.fontFamily])

  useEffect(() => {
    const onResize = () => measure()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [measure])

  const goPage = useCallback(
    (delta: number) => {
      // 滚动模式没有页码概念，翻页即沿滚动轴前进/后退一屏
      if (config.pageMode === 'scroll') {
        const viewport = viewportRef.current
        if (viewport) {
          viewport.scrollBy({ top: delta * viewport.clientHeight, behavior: 'smooth' })
        }
        return
      }
      const next = pageIdx + delta
      if (next >= 0 && next < pageCount) {
        useReaderStore.getState().setPageIdx(next)
        return
      }
      if (next < 0) {
        void useReaderStore.getState().goChapter(chapterIdx - 1, { toLast: true })
        return
      }
      void useReaderStore.getState().goChapter(chapterIdx + 1)
    },
    [pageIdx, pageCount, chapterIdx, config.pageMode]
  )

  // 点击分区：三种模式统一为 左 30% 上一页 / 右 30% 下一页 / 中间 40% 切换菜单
  const onTapZone = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const rect = event.currentTarget.getBoundingClientRect()
      const ratio = (event.clientX - rect.left) / rect.width
      if (ratio < 0.3) goPage(-1)
      else if (ratio > 0.7) goPage(1)
      else setMenuVisible((visible) => !visible)
    },
    [goPage]
  )

  useEffect(() => {
    if (tocOpen || searchOpen || settingsOpen) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'ArrowLeft') goPage(-1)
      else if (event.key === 'ArrowRight') goPage(1)
      else if (event.key === 'Escape') setMenuVisible(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [goPage, tocOpen, searchOpen, settingsOpen])

  const onScroll = useCallback(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const maxScroll = viewport.scrollHeight - viewport.clientHeight
    useReaderStore.getState().setScrollRatio(maxScroll <= 0 ? 0 : viewport.scrollTop / maxScroll)
  }, [])

  useEffect(() => useReaderStore.getState().startStats(), [])

  const currentBookmarked = useMemo(
    () => bookmarks.some((b) => b.chapterIdx === chapterIdx && b.pageIdx === pageIdx),
    [bookmarks, chapterIdx, pageIdx]
  )

  const onToggleBookmark = useCallback(async () => {
    if (!chapter) return
    const { pageIdx: currentPage, pageOffsets } = useReaderStore.getState()
    await useReaderStore.getState().toggleBookmark({
      bookId,
      chapterIdx,
      pageIdx: currentPage,
      pageIdxRatio: pageOffsets[currentPage] ?? 0,
      snippet: chapter.content.slice(0, 60).replace(/\s+/g, ' ').trim()
    })
  }, [chapter, bookId, chapterIdx])

  if (loading) {
    return (
      <div className="reader-shell reader-loading" style={{ background: theme.background }}>
        <div className="loading-skeleton" style={{ maxWidth: 480 }} />
      </div>
    )
  }

  if (error) {
    return (
      <div
        className="reader-shell reader-message"
        style={{ background: theme.background, color: theme.foreground }}
      >
        <p>{error}</p>
        <button type="button" className="btn-ghost" onClick={onBack}>
          返回书架
        </button>
      </div>
    )
  }

  if (!chapters.length) {
    return (
      <div
        className="reader-shell reader-message"
        style={{ background: theme.background, color: theme.foreground }}
      >
        <p>该书没有章节信息</p>
        <button type="button" className="btn-ghost" onClick={onBack}>
          返回书架
        </button>
      </div>
    )
  }

  const contentStyle = {
    fontSize: `${config.fontSize}px`,
    lineHeight: config.lineSpacing,
    fontFamily: config.fontFamily || undefined
  }
  // 绝对定位的测量层/翻页层不继承父级 padding，需各自应用，保证测量宽度与可视宽度一致
  const layerPadding = { padding: `${READER_PADDING_V}px ${READER_PADDING_H}px` }

  // 章节标题在导入时已从正文中剥离（body 从标题行之后开始），
  // 此处在正文顶部重新呈现；测量层与可视层必须一致，否则分页错位。
  const chapterHeading = chapter ? (
    <div className="reader-chapter-heading">{chapter.title}</div>
  ) : null

  return (
    <div
      className="reader-shell"
      style={
        {
          background: theme.background,
          // 暴露主题色给菜单层/按钮，保证浅色主题（纸白/米黄等）下浮层对比度
          '--reader-bg': theme.background,
          '--reader-fg': theme.foreground
        } as CSSProperties
      }
    >
      <ReaderMenu
        visible={menuVisible}
        title={bookTitle}
        theme={theme}
        chapterTitle={chapter?.title ?? ''}
        chapterIdx={chapterIdx}
        chapterCount={chapters.length}
        pageIdx={pageIdx}
        pageCount={pageCount}
        percent={bookPercent}
        bookmarked={currentBookmarked}
        onBack={onBack}
        onOpenToc={() => setTocOpen(true)}
        onOpenSearch={() => setSearchOpen(true)}
        onOpenSettings={() => setSettingsOpen(true)}
        onToggleBookmark={onToggleBookmark}
        onPrevChapter={() => void useReaderStore.getState().goChapter(chapterIdx - 1)}
        onNextChapter={() => void useReaderStore.getState().goChapter(chapterIdx + 1)}
        onSeek={(ratio) => useReaderStore.getState().seek(ratio)}
      />

      <div
        ref={viewportRef}
        className={`reader-viewport mode-${config.pageMode}`}
        onScroll={config.pageMode === 'scroll' ? onScroll : undefined}
        onClick={onTapZone}
      >
        {config.pageMode === 'scroll' ? (
          <div
            ref={contentRef}
            className="reader-content"
            style={{ ...contentStyle, ...layerPadding, color: theme.foreground }}
          >
            {chapterHeading}
            {chapter?.content}
          </div>
        ) : (
          <>
            {/* 离屏测量层：与可视层同一套样式与内边距，仅用于测量整章真实高度 */}
            <div
              ref={contentRef}
              className="reader-measure"
              style={layerPadding}
              aria-hidden="true"
            >
              <div className="reader-content" style={contentStyle}>
                {chapterHeading}
                {chapter?.content}
              </div>
            </div>

            {/* 可视层：整章一次渲染，按页偏移裁剪出当前页 */}
            <div className="reader-pager" style={layerPadding}>
              <div
                className="reader-page-slot"
                style={{ transform: `translateY(-${pageIdx * pageHeight}px)` }}
              >
                <div
                  className="reader-content"
                  style={{ ...contentStyle, color: theme.foreground }}
                >
                  {chapterHeading}
                  {chapter?.content}
                </div>
              </div>
            </div>

            <div className="reader-page-hint" aria-hidden="true">
              {pageIdx + 1} / {pageCount}
            </div>
          </>
        )}
      </div>

      {config.brightnessMask > 0 ? (
        <div
          className="reader-brightness"
          style={{ background: `rgba(0,0,0,${Math.min(0.6, config.brightnessMask)})` }}
          aria-hidden="true"
        />
      ) : null}

      {tocOpen ? (
        <TocSheet
          chapters={chapters}
          bookmarks={bookmarks}
          currentChapterIdx={chapterIdx}
          theme={theme}
          onClose={() => setTocOpen(false)}
          onSelectChapter={(idx) => {
            void useReaderStore.getState().goChapter(idx)
            setTocOpen(false)
          }}
          onSelectBookmark={(bookmark: Bookmark) => {
            void useReaderStore.getState().jumpToBookmark(bookmark)
            setTocOpen(false)
          }}
          onDeleteBookmark={(id) => void useReaderStore.getState().deleteBookmark(id)}
        />
      ) : null}

      {searchOpen ? (
        <SearchSheet
          bookId={bookId}
          chapters={chapters}
          theme={theme}
          onClose={() => setSearchOpen(false)}
          onSelect={(targetChapterIdx, ratio) => {
            void useReaderStore.getState().jumpToRatio(targetChapterIdx, ratio)
            setSearchOpen(false)
          }}
        />
      ) : null}

      {settingsOpen ? (
        <ReadSettingsPanel theme={theme} onClose={() => setSettingsOpen(false)} />
      ) : null}
    </div>
  )
}

export type { ChapterContent, ChapterMeta }