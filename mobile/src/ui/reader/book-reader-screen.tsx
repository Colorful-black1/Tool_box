/**
 * 阅读器（M4）：目录、正文、翻页 / 滚动、进度、书签、阅读设置。
 *
 * 两种阅读模式共用一套状态：
 * - `scroll`：ScrollView 上下滚动，进度 = 滚动比例；
 * - `horizontal`：按 `paginate.ts` 估算的页容量切片，进度 = 页码比例。
 * 两者对外暴露的「章内百分比」一致，所以进度与书签的存取格式完全通用，
 * 中途切换模式不会丢位置（书签的 pageIdx 只在分页模式下有精确意义，
 * 滚动模式下同一章只保留 pageIdx = 0 的那一个）。
 *
 * 统计的结算时机：切章或退出阅读页时 flush，不按秒写库 ——
 * 否则每滚动一次都要 UPDATE 一次 `reading_stats`，纯浪费。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions
} from 'react-native'
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native'

import { GhostButton, PromptModal } from '../../components/ui'
import { READER_PADDING_H, READER_PADDING_V } from '../../data/constants'
import { DEFAULT_READER_PREFS, themeOf, toReaderPrefs } from '../../data/reader-config'
import type { ReaderPrefs } from '../../data/reader-config'
import { useServices } from '../../runtime/services'
import type { Bookmark, BookSummary, ChapterContent, ChapterMeta } from '../../shared-bridge'
import {
  clampPageIndex,
  estimatePageChars,
  pageToPercent,
  paginateText,
  percentToPage,
  textSnippet
} from './paginate'
import { ReaderSettingsSheet } from './reader-settings-sheet'
import { ReaderSearchSheet } from './reader-search-sheet'
import { colors, radius, spacing } from '../../theme'

/** 顶部工具条与底部翻页条合计占用的高度，用于从可用高度里扣掉 */
const CHROME_HEIGHT = 96

/** 进度落盘防抖：翻页很频繁，没必要每翻一页写一次库 */
const PROGRESS_SAVE_DELAY_MS = 800

interface StatSegment {
  chapterIdx: number
  startedAt: number
  chars: number
}

const EMPTY_SEGMENT: StatSegment = { chapterIdx: -1, startedAt: 0, chars: 0 }

export function BookReaderScreen({
  book,
  onBack
}: {
  book: BookSummary
  onBack: () => void
}): ReactNode {
  const { store } = useServices()
  const window = useWindowDimensions()

  const [prefs, setPrefs] = useState<ReaderPrefs>(DEFAULT_READER_PREFS)
  const [chapters, setChapters] = useState<ChapterMeta[]>([])
  const [chapterIdx, setChapterIdx] = useState(Math.max(0, book.progress?.chapterIdx ?? 0))
  const [content, setContent] = useState<ChapterContent | null>(null)
  const [pageIndex, setPageIndex] = useState(0)
  const [scrollPercent, setScrollPercent] = useState(book.progress?.percent ?? 0)
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([])
  const [error, setError] = useState('')
  const [catalogOpen, setCatalogOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [renameOpen, setRenameOpen] = useState(false)

  /** 载入新章节时要兑现的进度；兑现后置空，避免字号变化时被重复应用 */
  const restorePercentRef = useRef<number | null>(book.progress?.percent ?? null)
  /** 已兑现过进度的章节 id，用来区分「换章」与「改字号导致重新分页」 */
  const restoredChapterRef = useRef<number>(-1)
  /** 等待「内容高度与视口都已知」之后执行的那一次滚动 */
  const pendingScrollRef = useRef<number | null>(null)
  const scrollRef = useRef<ScrollView>(null)
  const [metrics, setMetrics] = useState({ content: 0, viewport: 0 })

  const theme = themeOf(prefs)
  const pageChars = useMemo(
    () =>
      estimatePageChars({
        fontSize: prefs.fontSize,
        lineSpacing: prefs.lineSpacing,
        width: Math.max(120, window.width - READER_PADDING_H * 2),
        height: Math.max(160, window.height - CHROME_HEIGHT - READER_PADDING_V * 2)
      }),
    [prefs.fontSize, prefs.lineSpacing, window.height, window.width]
  )
  const pages = useMemo(
    () => (content ? paginateText(content.content, pageChars) : ['']),
    [content, pageChars]
  )
  const isPaged = prefs.pageMode === 'horizontal'
  const percent = isPaged ? pageToPercent(pageIndex, pages.length) : scrollPercent

  // ---------- 统计分段 ----------

  const segmentRef = useRef<StatSegment>(EMPTY_SEGMENT)
  const countedRef = useRef(0)
  const seenPagesRef = useRef<Set<number>>(new Set())

  /** 结算当前统计分段；失败只忽略，不打扰阅读 */
  const flushStats = useCallback(
    (segment: StatSegment): void => {
      const durationMs = Date.now() - segment.startedAt
      // 点开又立刻退出会攒出一堆 0 秒记录，直接跳过
      if (durationMs < 1000 && segment.chars === 0) return
      void (async () => {
        try {
          await store.addStatsToday(durationMs, segment.chars)
        } catch {
          /* 统计写入失败不影响阅读 */
        }
      })()
    },
    [store]
  )

  // ---------- 载入 ----------

  useEffect(() => {
    let disposed = false
    void (async () => {
      try {
        const [list, marks, config] = await Promise.all([
          store.listChapters(book.id),
          store.listBookmarks(book.id),
          store.configGet()
        ])
        if (disposed) return
        setChapters(list)
        setBookmarks(marks)
        setPrefs(toReaderPrefs(config))
      } catch (loadError) {
        if (!disposed) setError(loadError instanceof Error ? loadError.message : '读取失败')
      }
    })()
    return () => {
      disposed = true
    }
  }, [book.id, store])

  useEffect(() => {
    if (chapters.length === 0) return
    if (chapterIdx < 0 || chapterIdx >= chapters.length) {
      setChapterIdx(0)
      return
    }
    let disposed = false
    void (async () => {
      try {
        const loaded = await store.chapterContent(chapters[chapterIdx].id)
        if (disposed) return
        setContent(loaded)
        setError('')
      } catch (loadError) {
        if (disposed) return
        setError(loadError instanceof Error ? loadError.message : '读取章节失败')
        setContent(null)
      }
    })()
    return () => {
      disposed = true
    }
  }, [chapterIdx, chapters, store])

  /**
   * 把一个章内比例落到具体位置：分页模式换算成页码，滚动模式挂起一次 scrollTo。
   *
   * 用 `restoredChapterRef` 判重而不是「跑一次就清空」：改字号会让 `pages`
   * 重新分页，若无脑重置页码，用户每调一次字号就跳回第一页。
   * 只有换了章节（或书签跳转）才重新兑现。
   */
  const applyRestore = useCallback(
    (rawRatio: number): void => {
      const ratio = Math.min(1, Math.max(0, rawRatio))
      restoredChapterRef.current = content?.idx ?? -1
      setPageIndex(percentToPage(ratio, pages.length))
      setScrollPercent(ratio)
      pendingScrollRef.current = ratio
    },
    [content?.idx, pages.length]
  )

  useEffect(() => {
    if (!content) return
    if (restoredChapterRef.current === content.idx) return
    applyRestore(restorePercentRef.current ?? 0)
    restorePercentRef.current = null
  }, [applyRestore, content])

  // 视口与内容高度都拿到后才执行挂起的跳转，否则 scrollTo 会落在 0
  useEffect(() => {
    if (pendingScrollRef.current === null) return
    const scrollable = metrics.content - metrics.viewport
    if (scrollable <= 0) return
    scrollRef.current?.scrollTo({ y: pendingScrollRef.current * scrollable, animated: false })
    pendingScrollRef.current = null
  }, [metrics])

  // ---------- 进度落盘 ----------

  useEffect(() => {
    if (!content) return
    const timer = setTimeout(() => {
      void (async () => {
        try {
          await store.progressSave({ bookId: book.id, chapterIdx: content.idx, percent })
        } catch {
          // 进度保存失败不该打断阅读，下次翻页会再试
        }
      })()
    }, PROGRESS_SAVE_DELAY_MS)
    return () => {
      clearTimeout(timer)
    }
  }, [book.id, content, percent, store])

  // ---------- 模式切换 ----------

  const modeRef = useRef(prefs.pageMode)
  useEffect(() => {
    const previous = modeRef.current
    modeRef.current = prefs.pageMode
    if (previous === prefs.pageMode) return

    const wasPaged = previous === 'horizontal'
    if (wasPaged && !isPaged) {
      // 分页 → 滚动：按当前比例定位
      pendingScrollRef.current = percent
      setScrollPercent(percent)
    } else if (!wasPaged && isPaged) {
      setPageIndex(percentToPage(percent, pages.length))
    }
  }, [isPaged, pages.length, percent, prefs.pageMode])

  // ---------- 字数统计 ----------

  // 分页模式：每翻到一个新页累加该页字数（同一页不重复计）
  useEffect(() => {
    if (!content || !isPaged) return
    if (seenPagesRef.current.has(pageIndex)) return
    seenPagesRef.current.add(pageIndex)
    segmentRef.current.chars += pages[pageIndex]?.length ?? 0
  }, [content, isPaged, pageIndex, pages])

  // 滚动模式：按「已读到的字数下界」增量累加
  useEffect(() => {
    if (!content || isPaged) return
    const target = Math.floor(scrollPercent * content.content.length)
    if (target <= countedRef.current) return
    segmentRef.current.chars += target - countedRef.current
    countedRef.current = target
  }, [content, isPaged, scrollPercent])

  // 退出阅读页时结算最后一段
  useEffect(() => {
    return () => {
      if (segmentRef.current.chapterIdx !== -1) flushStats(segmentRef.current)
    }
  }, [flushStats])

  // ---------- 交互 ----------

  /** 切章：结算上一段统计、重置计数、兑现进度 */
  const goChapter = useCallback(
    (next: number): void => {
      if (next < 0 || next >= chapters.length) return
      if (segmentRef.current.chapterIdx !== -1) flushStats(segmentRef.current)
      segmentRef.current = { chapterIdx: next, startedAt: Date.now(), chars: 0 }
      countedRef.current = 0
      seenPagesRef.current = new Set<number>()
      restorePercentRef.current = 0
      setChapterIdx(next)
    },
    [chapters.length, flushStats]
  )

  const goPage = (delta: number): void => {
    const next = pageIndex + delta
    if (next < 0) {
      goChapter(chapterIdx - 1)
      return
    }
    if (next >= pages.length) {
      goChapter(chapterIdx + 1)
      return
    }
    setPageIndex(next)
  }

  const jumpTo = (targetChapter: number, ratio: number): void => {
    setCatalogOpen(false)
    if (targetChapter === chapterIdx) {
      // 同一章内跳转不会触发换章 effect，直接兑现
      applyRestore(ratio)
      return
    }
    goChapter(targetChapter)
    restorePercentRef.current = ratio
  }

  const currentSnippet = useMemo(
    () => textSnippet(isPaged ? (pages[pageIndex] ?? '') : (content?.content ?? '')),
    [content, isPaged, pageIndex, pages]
  )

  const isBookmarked = useMemo(() => {
    if (!content) return false
    return bookmarks.some(
      (mark) =>
        mark.chapterIdx === content.idx && (isPaged ? mark.pageIdx === pageIndex : mark.pageIdx === 0)
    )
  }, [bookmarks, content, isPaged, pageIndex])

  const toggleBookmark = async (): Promise<void> => {
    if (!content) return
    try {
      await store.toggleBookmark({
        bookId: book.id,
        chapterIdx: content.idx,
        pageIdx: isPaged ? pageIndex : 0,
        pageIdxRatio: percent,
        snippet: currentSnippet
      })
      setBookmarks(await store.listBookmarks(book.id))
    } catch (toggleError) {
      setError(toggleError instanceof Error ? toggleError.message : '书签操作失败')
    }
  }

  const removeBookmark = (mark: Bookmark): void => {
    Alert.alert('删除书签', '确定删除这条书签？', [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            try {
              await store.deleteBookmark(mark.id)
              setBookmarks(await store.listBookmarks(book.id))
            } catch (deleteError) {
              setError(deleteError instanceof Error ? deleteError.message : '删除书签失败')
            }
          })()
        }
      }
    ])
  }

  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>): void => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent
    const scrollable = contentSize.height - layoutMeasurement.height
    if (scrollable <= 0) return
    setScrollPercent(Math.min(1, Math.max(0, contentOffset.y / scrollable)))
  }

  const textStyle = {
    color: theme.foreground,
    fontSize: prefs.fontSize,
    lineHeight: prefs.fontSize * prefs.lineSpacing,
    fontFamily: prefs.fontFamily || undefined
  }

  return (
    <View style={[styles.root, { backgroundColor: theme.background }]}>
      <View style={styles.toolbar}>
        <GhostButton label="返回" onPress={onBack} />
        <Text style={styles.toolbarTitle} numberOfLines={1}>
          {content?.title ?? book.title}
        </Text>
        <View style={styles.toolbarActions}>
          <GhostButton
            label={isBookmarked ? '★' : '☆'}
            onPress={() => void toggleBookmark()}
            disabled={!content}
          />
          <GhostButton label="目录" onPress={() => setCatalogOpen(true)} />
          <GhostButton label="搜索" onPress={() => setSearchOpen(true)} />
          <GhostButton label="Aa" onPress={() => setSettingsOpen(true)} />
        </View>
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {isPaged ? (
        <View style={styles.pageArea}>
          <Pressable style={styles.tapZone} onPress={() => goPage(-1)} accessibilityLabel="上一页" />
          <ScrollView style={styles.pageScroll} showsVerticalScrollIndicator={false}>
            <Text style={[styles.body, textStyle]} selectable>
              {pages[clampPageIndex(pageIndex, pages.length)]}
            </Text>
          </ScrollView>
          <Pressable style={styles.tapZone} onPress={() => goPage(1)} accessibilityLabel="下一页" />
        </View>
      ) : (
        <ScrollView
          ref={scrollRef}
          style={styles.scrollArea}
          onScroll={onScroll}
          scrollEventThrottle={200}
          showsVerticalScrollIndicator={false}
          onContentSizeChange={(_width, height) =>
            setMetrics((current) => ({ ...current, content: height }))
          }
          onLayout={(event) =>
            setMetrics((current) => ({ ...current, viewport: event.nativeEvent.layout.height }))
          }
        >
          <Text style={[styles.body, textStyle]} selectable>
            {content?.content ?? ''}
          </Text>
        </ScrollView>
      )}

      <View style={styles.footer}>
        <GhostButton label="上一章" onPress={() => goChapter(chapterIdx - 1)} disabled={chapterIdx <= 0} />
        <Text style={styles.footerMeta}>
          {isPaged
            ? `${chapterIdx + 1}/${chapters.length} 章 · ${pageIndex + 1}/${pages.length} 页`
            : `${chapterIdx + 1}/${chapters.length} 章 · ${Math.round(percent * 100)}%`}
        </Text>
        <GhostButton
          label="下一章"
          onPress={() => goChapter(chapterIdx + 1)}
          disabled={chapterIdx >= chapters.length - 1}
        />
      </View>

      <CatalogModal
        visible={catalogOpen}
        chapters={chapters}
        currentIdx={content?.idx ?? chapterIdx}
        bookmarks={bookmarks}
        onClose={() => setCatalogOpen(false)}
        onJump={(idx) => goChapter(idx)}
        onJumpBookmark={(mark) => jumpTo(mark.chapterIdx, mark.pageIdxRatio)}
        onRemoveBookmark={removeBookmark}
        onRenameBook={() => {
          setCatalogOpen(false)
          setRenameOpen(true)
        }}
      />

      <ReaderSettingsSheet
        visible={settingsOpen}
        prefs={prefs}
        onChange={setPrefs}
        onClose={() => setSettingsOpen(false)}
      />

      <ReaderSearchSheet
        visible={searchOpen}
        bookId={book.id}
        onClose={() => setSearchOpen(false)}
        onSelect={(hit) => {
          setSearchOpen(false)
          jumpTo(hit.chapterIdx, hit.ratio)
        }}
      />

      <PromptModal
        visible={renameOpen}
        title="重命名书籍"
        initialValue={book.title}
        onCancel={() => setRenameOpen(false)}
        onConfirm={(name) => {
          setRenameOpen(false)
          void (async () => {
            try {
              await store.updateBookMeta(book.id, { title: name })
            } catch (renameError) {
              setError(renameError instanceof Error ? renameError.message : '重命名失败')
            }
          })()
        }}
      />
    </View>
  )
}

/** 目录 / 书签列表弹窗 */
function CatalogModal({
  visible,
  chapters,
  currentIdx,
  bookmarks,
  onClose,
  onJump,
  onJumpBookmark,
  onRemoveBookmark,
  onRenameBook
}: {
  visible: boolean
  chapters: ChapterMeta[]
  currentIdx: number
  bookmarks: Bookmark[]
  onClose: () => void
  onJump: (chapterIdx: number) => void
  onJumpBookmark: (mark: Bookmark) => void
  onRemoveBookmark: (mark: Bookmark) => void
  onRenameBook: () => void
}): ReactNode {
  const [tab, setTab] = useState<'catalog' | 'marks'>('catalog')

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      accessibilityViewIsModal
    >
      <Pressable style={styles.modalBackdrop} onPress={onClose} accessibilityLabel="关闭" />
      <View style={styles.modalCard}>
        <View style={styles.modalHeader}>
          <Pressable
            accessibilityRole="button"
            onPress={() => setTab('catalog')}
            style={styles.modalTab}
          >
            <Text style={[styles.modalTabLabel, tab === 'catalog' && styles.modalTabLabelActive]}>
              目录 {chapters.length}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => setTab('marks')}
            style={styles.modalTab}
          >
            <Text style={[styles.modalTabLabel, tab === 'marks' && styles.modalTabLabelActive]}>
              书签 {bookmarks.length}
            </Text>
          </Pressable>
          <GhostButton label="改名" onPress={onRenameBook} />
          <GhostButton label="关闭" onPress={onClose} />
        </View>

        <ScrollView style={styles.modalList}>
          {tab === 'catalog'
            ? chapters.map((chapter) => (
                <Pressable
                  key={chapter.id}
                  accessibilityRole="button"
                  onPress={() => onJump(chapter.idx)}
                  style={({ pressed }) => [styles.modalRow, pressed && styles.pressed]}
                >
                  <Text
                    style={[styles.modalRowLabel, chapter.idx === currentIdx && styles.modalRowActive]}
                    numberOfLines={1}
                  >
                    {chapter.idx + 1}. {chapter.title}
                  </Text>
                  <Text style={styles.modalRowMeta}>{chapter.wordCount} 字</Text>
                </Pressable>
              ))
            : bookmarks.map((mark) => (
                <Pressable
                  key={mark.id}
                  accessibilityRole="button"
                  onPress={() => onJumpBookmark(mark)}
                  onLongPress={() => onRemoveBookmark(mark)}
                  style={({ pressed }) => [styles.modalRow, pressed && styles.pressed]}
                >
                  <Text style={styles.modalRowLabel} numberOfLines={1}>
                    第 {mark.chapterIdx + 1} 章 · {Math.round(mark.pageIdxRatio * 100)}%
                  </Text>
                  <Text style={styles.modalRowMeta} numberOfLines={1}>
                    {mark.snippet}
                  </Text>
                </Pressable>
              ))}
          {tab === 'marks' && bookmarks.length === 0 ? (
            <Text style={styles.modalEmpty}>还没有书签。阅读时点顶部「☆」即可标记当前段落。</Text>
          ) : null}
        </ScrollView>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
    gap: spacing.xs
  },
  // 工具条在窄屏上必须保证按钮完整：标题负责收缩并单行截断，按钮不参与收缩
  toolbarTitle: { flex: 1, fontSize: 13, color: colors.textMid },
  toolbarActions: { flexDirection: 'row', gap: spacing.xs, flexShrink: 0 },
  error: { color: colors.danger, fontSize: 11, paddingHorizontal: spacing.lg, paddingBottom: spacing.xs },
  scrollArea: { flex: 1 },
  pageArea: { flex: 1, flexDirection: 'row' },
  pageScroll: { flex: 1 },
  tapZone: { flex: 1 },
  body: {
    paddingHorizontal: READER_PADDING_H,
    paddingVertical: READER_PADDING_V
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.sm
  },
  footerMeta: { flex: 1, fontSize: 11, color: colors.textDim, textAlign: 'center' },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(8, 11, 22, 0.72)' },
  modalCard: {
    maxHeight: '80%',
    backgroundColor: colors.bgPanelSolid,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm
  },
  modalTab: { paddingVertical: 6, paddingHorizontal: spacing.md },
  modalTabLabel: { color: colors.textDim, fontSize: 13 },
  modalTabLabelActive: { color: colors.gold },
  modalList: { maxHeight: 420 },
  modalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.lineSoft
  },
  modalRowLabel: { flex: 1, fontSize: 13, color: colors.textHi },
  modalRowActive: { color: colors.gold },
  modalRowMeta: { fontSize: 10, color: colors.textDim },
  modalEmpty: { color: colors.textDim, fontSize: 12, padding: spacing.lg, lineHeight: 18 },
  pressed: { opacity: 0.7 }
})
