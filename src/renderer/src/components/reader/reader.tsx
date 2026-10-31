import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, JSX } from 'react'

import { READER_PADDING_H, READER_PADDING_V } from '../../../../shared/constants'
import { buildReaderExcerpt, buildReaderQuestion } from '../../../../shared/reader-excerpt'
import { effectiveReaderTheme } from '../../../../shared/types'
import type { Bookmark, ChapterContent, ChapterMeta } from '../../../../shared/types'
import { paginate } from '../../lib/paginator'
import { splitReaderParagraphs } from '../../lib/reader-text'
import { useAppStore } from '../../stores/app-store'
import { useConfigStore } from '../../stores/config-store'
import { useReaderStore } from '../../stores/reader-store'
import { ReadSettingsPanel } from './read-settings-panel'
import { ReaderMenu } from './reader-menu'
import { SearchSheet } from './search-sheet'
import { TocSheet } from './toc-sheet'

export interface ReaderProps {
  bookId: string
  bookTitle: string
  initialChapterIdx?: number
  onBack: () => void
}

/**
 * 滚动模式没有「当前页」，书签去重键借用一个大页码前缀 + 章内千分比生成。
 * 分页模式的真实页号远小于这个基数，两种模式的书签不会互相覆盖，且仍满足 IPC 的非负整数校验。
 */
const SCROLL_BOOKMARK_PAGE_BASE = 1_000_000

/**
 * 阅读器：对应旧项目 reader_page.dart + reader_menu.dart。
 * 布局 = 顶部浮层菜单 + 正文区分页/滚动 + 目录抽屉 + 书内搜索 + 阅读设置面板。
 */
export function Reader({ bookId, bookTitle, initialChapterIdx, onBack }: ReaderProps): JSX.Element {
  // 只订阅需要的字段：整店订阅会在每次 setState 时返回新对象，
  // 导致依赖 store 的 useCallback / useEffect 反复重建并触发渲染循环。
  const chapters = useReaderStore((state) => state.chapters)
  const chapter = useReaderStore((state) => state.chapter)
  const chapterIdx = useReaderStore((state) => state.chapterIdx)
  const pageIdx = useReaderStore((state) => state.pageIdx)
  const bookmarks = useReaderStore((state) => state.bookmarks)
  const bookPercent = useReaderStore((state) => state.bookPercent)
  const seekSequence = useReaderStore((state) => state.seekSequence)

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
  /** 代码要写入的 scrollTop；停在它上面的 scroll 事件不当作阅读行为。 */
  const programmaticTarget = useRef<number | null>(null)
  const [pageCount, setPageCount] = useState(1)
  /** 正文选区与浮出按钮的位置（相对阅读器容器）；没有选区时为 null。 */
  const [excerpt, setExcerpt] = useState<{ text: string; top: number; left: number } | null>(null)
  const [excerptSaving, setExcerptSaving] = useState(false)
  const [excerptFlash, setExcerptFlash] = useState('')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')

    void (async () => {
      try {
        await useReaderStore.getState().loadBook(bookId, initialChapterIdx)
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
  }, [bookId, initialChapterIdx])

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
      // 拖选文字结束时浏览器仍会派发 click，此时不应翻页或收起菜单。
      const selection = window.getSelection()
      if (selection && !selection.isCollapsed && selection.toString().trim()) return
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
      // 命令面板、确认弹窗等模态层打开时按键归它们所有。阅读器监听挂在 window 上，
      // 不拦的话在搜索框里按 ← → 会把背后的章节翻走。
      if (document.querySelector('[data-modal-owner]')) return
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        // 菜单里的进度滑块用 ← → 调进度，放行给它，否则会一边调进度一边翻页。
        // Shift + ← → 用来扩展文字选区，交给浏览器，不翻页。
        const target = event.target
        if (
          event.shiftKey ||
          (target instanceof HTMLElement &&
            target.closest('input, textarea, select, [contenteditable="true"]'))
        )
          return
        goPage(event.key === 'ArrowLeft' ? -1 : 1)
      } else if (event.key === ' ' || event.key === 'PageDown' || event.key === 'PageUp') {
        // 阅读器视口不可聚焦，空格本身不会滚动它；交给控件的情况（按钮 / 输入框里
        // 空格等于激活或输入）必须先放行，否则会既翻页又触发控件。
        const target = event.target
        if (
          target instanceof HTMLElement &&
          target.closest('button, input, textarea, select, [contenteditable="true"]')
        )
          return
        // Ctrl/Alt + 空格常用于输入法切换或系统快捷方式，不抢。
        if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return
        event.preventDefault()
        goPage(event.key === 'PageUp' || (event.key === ' ' && event.shiftKey) ? -1 : 1)
      } else if (event.key === 'm' || event.key === 'M') {
        // 菜单收起后只剩点击屏幕中间能唤回，键盘用户会被卡在没有入口的正文里。
        if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return
        event.preventDefault()
        setMenuVisible((visible) => !visible)
      } else if (event.key === 'Escape' && menuVisible) {
        event.preventDefault()
        setMenuVisible(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [goPage, tocOpen, searchOpen, settingsOpen, menuVisible])

  // 选中正文文字后浮出「存入记事本 / 问 AI」入口。拖选过程中只在选区清空时收起，
  // 定位推迟到松开鼠标 / 按键后，避免长篇正文跟着每个 selectionchange 重渲染。
  useEffect(() => {
    const locate = (): void => {
      const viewport = viewportRef.current
      const selection = window.getSelection()
      if (!viewport || !selection || selection.isCollapsed || !selection.rangeCount) {
        setExcerpt(null)
        return
      }
      const node = selection.focusNode
      const text = selection.toString().trim()
      if (!node || !viewport.contains(node) || !text) {
        setExcerpt(null)
        return
      }
      const rect = selection.getRangeAt(0).getBoundingClientRect()
      const host = viewport.getBoundingClientRect()
      if (!rect.width && !rect.height) {
        setExcerpt(null)
        return
      }
      // 选区贴近底部时按钮翻到上方，左右各留出按钮宽度，避免被容器裁掉。
      const above = rect.bottom + 44 > host.bottom
      const top = above
        ? Math.max(8, rect.top - host.top - 42)
        : Math.min(rect.bottom - host.top + 10, host.height - 42)
      const left = Math.min(Math.max(rect.left - host.left + rect.width / 2, 96), host.width - 96)
      setExcerpt({ text, top, left })
    }
    const onSelectionChange = (): void => {
      const selection = window.getSelection()
      if (!selection || selection.isCollapsed) setExcerpt(null)
    }
    document.addEventListener('selectionchange', onSelectionChange)
    document.addEventListener('mouseup', locate)
    document.addEventListener('keyup', locate)
    // 滚动模式下选区会随内容移动，按钮跟随；滚出可视区时收起。
    document.addEventListener('scroll', locate, true)
    return () => {
      document.removeEventListener('selectionchange', onSelectionChange)
      document.removeEventListener('mouseup', locate)
      document.removeEventListener('keyup', locate)
      document.removeEventListener('scroll', locate, true)
    }
  }, [])

  useEffect(() => {
    if (!excerptFlash) return
    const timer = window.setTimeout(() => setExcerptFlash(''), 2400)
    return () => window.clearTimeout(timer)
  }, [excerptFlash])

  const onSaveExcerpt = useCallback(async () => {
    if (!excerpt || excerptSaving) return
    const note = buildReaderExcerpt({
      bookTitle,
      chapterTitle: chapter?.title ?? '',
      chapterIdx,
      selectedText: excerpt.text
    })
    if (!note) return
    if (!window.toolbox) {
      setExcerptFlash('记事本暂不可用，请稍后重试')
      return
    }
    setExcerptSaving(true)
    try {
      await useAppStore.getState().saveNote(note)
      setExcerptFlash('已存入记事本')
      setExcerpt(null)
      window.getSelection()?.removeAllRanges()
    } catch {
      // 保存失败的原因（通道异常等）对用户没有可操作价值，只给重试提示。
      setExcerptFlash('保存失败，请重试')
    } finally {
      setExcerptSaving(false)
    }
  }, [excerpt, excerptSaving, bookTitle, chapter?.title, chapterIdx])

  // 问 AI 不直接发送：把原文与来源放进对话草稿，用户确认措辞后再发。
  const onAskAi = useCallback(() => {
    if (!excerpt) return
    const question = buildReaderQuestion({
      bookTitle,
      chapterTitle: chapter?.title ?? '',
      chapterIdx,
      selectedText: excerpt.text
    })
    if (!question) return
    useAppStore.getState().setChatDraft(question)
    useAppStore.getState().setView('chat')
    setExcerpt(null)
    window.getSelection()?.removeAllRanges()
  }, [excerpt, bookTitle, chapter?.title, chapterIdx])

  const onScroll = useCallback(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    // 打开书籍 / 跳转时由代码写入的位置不是用户阅读行为，不记入进度与阅读字数。
    // 一次赋值可能触发多个 scroll 事件，只要还停在目标位置就都忽略。
    const target = programmaticTarget.current
    if (target !== null) {
      if (Math.abs(viewport.scrollTop - target) < 1) return
      programmaticTarget.current = null
    }
    const maxScroll = viewport.scrollHeight - viewport.clientHeight
    useReaderStore.getState().setScrollRatio(maxScroll <= 0 ? 0 : viewport.scrollTop / maxScroll)
  }, [])

  // 滚动模式里视口自己持有滚动位置：进度条、书签、搜索和切章只改 store 的比例，
  // 不落到 scrollTop 画面就不会动（旧实现里这些跳转在该模式下不生效）。
  // 字号 / 行距 / 字体改变会重排内容，滚动位置也要按比例重算，否则阅读位置会漂移。
  useEffect(() => {
    if (config.pageMode !== 'scroll') return
    const viewport = viewportRef.current
    if (!viewport) return
    const frame = requestAnimationFrame(() => {
      const maxScroll = Math.max(viewport.scrollHeight - viewport.clientHeight, 0)
      const target = useReaderStore.getState().scrollRatio * maxScroll
      // 位置没变时浏览器不会发 scroll 事件，不设标记，免得挡住之后的真实滚动。
      if (Math.abs(viewport.scrollTop - target) < 1) return
      programmaticTarget.current = target
      viewport.scrollTop = target
    })
    return () => cancelAnimationFrame(frame)
  }, [
    seekSequence,
    config.pageMode,
    config.fontSize,
    config.lineSpacing,
    config.fontFamily,
    chapter?.id
  ])

  useEffect(() => useReaderStore.getState().startStats(), [])

  const scrollMode = config.pageMode === 'scroll'
  // 滚动模式没有页码，星标按「本章是否有书签」显示；分页模式仍精确到当前页。
  const currentBookmarked = useMemo(
    () =>
      bookmarks.some(
        (bookmark) =>
          bookmark.chapterIdx === chapterIdx && (scrollMode || bookmark.pageIdx === pageIdx)
      ),
    [bookmarks, chapterIdx, pageIdx, scrollMode]
  )

  // 章节正文按 TXT 原有换行切成段落，渲染层统一做首行缩进与段间距，
  // 不再依赖文件里的全角空格，也避免整章被 pre-wrap 拉成一大段。
  const paragraphs = useMemo(
    () => splitReaderParagraphs(chapter?.content ?? ''),
    [chapter?.content]
  )

  const onToggleBookmark = useCallback(async () => {
    if (!chapter) return
    const store = useReaderStore.getState()
    const snippet = chapter.content.slice(0, 60).replace(/\s+/g, ' ').trim()

    if (config.pageMode === 'scroll') {
      // 滚动模式下 pageIdx 恒为 0：旧实现把书签存到 chapterIdx + 0，回跳总是章首。
      const ratio = store.scrollRatio
      const nearest = bookmarks
        .filter((bookmark) => bookmark.chapterIdx === chapterIdx)
        .sort(
          (a, b) => Math.abs(a.pageIdxRatio - ratio) - Math.abs(b.pageIdxRatio - ratio)
        )[0]
      if (nearest) {
        // 星标在本章已亮起，再点表示取消：删掉离当前位置最近的一条。
        await store.deleteBookmark(nearest.id)
        return
      }
      await store.toggleBookmark({
        bookId,
        chapterIdx,
        pageIdx: SCROLL_BOOKMARK_PAGE_BASE + Math.floor(ratio * 1000),
        pageIdxRatio: ratio,
        snippet
      })
      return
    }

    await store.toggleBookmark({
      bookId,
      chapterIdx,
      pageIdx: store.pageIdx,
      pageIdxRatio: store.pageOffsets[store.pageIdx] ?? 0,
      snippet
    })
  }, [bookmarks, chapter, bookId, chapterIdx, config.pageMode])

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
  // 绝对定位的测量层/翻页插槽不继承普通流内边距，需各自应用，保证测量宽度与可视宽度一致
  const layerPadding = { padding: `${READER_PADDING_V}px ${READER_PADDING_H}px` }

  // 章节标题在导入时已从正文中剥离（body 从标题行之后开始），
  // 此处在正文顶部重新呈现；测量层与可视层必须一致，否则分页错位。
  const chapterHeading = chapter ? (
    <div className="reader-chapter-heading">{chapter.title}</div>
  ) : null
  const chapterBody = (
    <>
      {chapterHeading}
      <div className="reader-body">
        {paragraphs.map((paragraph, index) => (
          <p key={`${index}:${paragraph.slice(0, 12)}`}>{paragraph}</p>
        ))}
      </div>
    </>
  )

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

      {/* 抽屉 / 设置打开时选区入口会让位给模态层，关闭后重新选字即可再次出现。 */}
      {excerpt && !tocOpen && !searchOpen && !settingsOpen ? (
        <div className="reader-excerpt-actions" style={{ top: excerpt.top, left: excerpt.left }}>
          <button
            type="button"
            className="reader-excerpt-btn"
            disabled={excerptSaving}
            // 按下时保留选区：默认行为会先清空选区，导致要保存的文字消失。
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => void onSaveExcerpt()}
          >
            存入记事本
          </button>
          <button
            type="button"
            className="reader-excerpt-btn"
            onMouseDown={(event) => event.preventDefault()}
            onClick={onAskAi}
          >
            问 AI
          </button>
        </div>
      ) : null}
      {excerptFlash ? (
        <div className="reader-excerpt-flash" role="status">
          {excerptFlash}
        </div>
      ) : null}

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
            {chapterBody}
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
                {chapterBody}
              </div>
            </div>

            {/* 可视层：整章一次渲染，按页偏移裁剪出当前页。
                内边距放在 page-slot 上，绝对定位的插槽才会真正让出上/左右留白，
                与离屏测量层的 padding 保持一致。 */}
            <div className="reader-pager">
              <div
                className="reader-page-slot"
                style={{
                  ...layerPadding,
                  transform: `translateY(-${pageIdx * pageHeight}px)`
                }}
              >
                <div
                  className="reader-content"
                  style={{ ...contentStyle, color: theme.foreground }}
                >
                  {chapterBody}
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
