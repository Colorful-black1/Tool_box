import { create } from 'zustand'

import { STATS_FLUSH_TICKS } from '../../../shared/constants'
import type {
  BookSummary,
  Bookmark,
  ChapterContent,
  ChapterMeta
} from '../../../shared/types'

interface ReaderState {
  book: BookSummary | null
  chapters: ChapterMeta[]
  chapter: ChapterContent | null
  chapterIdx: number
  pageIdx: number
  pageCount: number
  pageOffsets: number[]
  scrollRatio: number
  bookmarks: Bookmark[]
  bookPercent: number

  loadBook(bookId: string): Promise<void>
  goChapter(idx: number, options?: { toLast?: boolean }): Promise<void>
  setPageIdx(idx: number): void
  setScrollRatio(ratio: number): void
  setPagination(pageCount: number, offsets: number[]): void
  seek(ratio: number): Promise<void>
  jumpToRatio(chapterIdx: number, ratio: number): Promise<void>
  jumpToBookmark(bookmark: Bookmark): Promise<void>
  toggleBookmark(input: {
    bookId: string
    chapterIdx: number
    pageIdx: number
    pageIdxRatio: number
    snippet: string
  }): Promise<void>
  deleteBookmark(id: string): Promise<void>
  saveProgress(): Promise<void>
  startStats(): () => void
}

let statsTimer: ReturnType<typeof setInterval> | null = null
let pendingDurationMs = 0
let pendingCharCount = 0
let sessionMaxRatio = 0

export const useReaderStore = create<ReaderState>((set, get) => ({
  book: null,
  chapters: [],
  chapter: null,
  chapterIdx: 0,
  pageIdx: 0,
  pageCount: 1,
  pageOffsets: [0],
  scrollRatio: 0,
  bookmarks: [],
  bookPercent: 0,
  // config 由阅读器直接订阅 config-store，这里不再复制一份

  loadBook: async (bookId) => {
    const bridge = window.toolbox
    if (!bridge) throw new Error('本地桥接未就绪')

    const [books, chapters, progress, bookmarks] = await Promise.all([
      bridge.books.list(),
      bridge.books.listChapters(bookId),
      bridge.books.progressGet(bookId),
      bridge.bookmarks.list(bookId)
    ])
    const book = books.find((item) => item.id === bookId)
    if (!book) throw new Error('书籍不存在')

    const startIdx = Math.min(progress?.chapterIdx ?? 0, Math.max(chapters.length - 1, 0))
    const target = chapters[startIdx]
    const chapter = target ? await bridge.books.chapterContent(target.id) : null

    // 以恢复的进度作为本次会话起点，不计入已读字数
    sessionMaxRatio = progress?.percent ?? 0

    set({
      book,
      chapters,
      chapter,
      chapterIdx: startIdx,
      pageIdx: 0,
      pageOffsets: [0],
      scrollRatio: 0,
      bookmarks,
      bookPercent: progress?.percent ?? 0
    })
  },

  goChapter: async (idx, options) => {
    const { chapters, chapterIdx } = get()
    if (idx < 0 || idx >= chapters.length || idx === chapterIdx) return
    const bridge = window.toolbox
    if (!bridge) return

    const target = chapters[idx]
    const chapter = await bridge.books.chapterContent(target.id)
    const toLast = options?.toLast === true

    set({ chapter, chapterIdx: idx, pageIdx: 0, scrollRatio: 0 })

    // 等分页测量完成后再定位到目标位置
    window.setTimeout(() => {
      if (toLast) {
        set({ pageIdx: Math.max(get().pageCount - 1, 0), scrollRatio: 1 })
      }
      void get().saveProgress()
    }, 80)

    advanceTo(toLast ? 1 : 0)
  },

  setPageIdx: (idx) => {
    const { pageCount, pageOffsets } = get()
    const clamped = Math.min(Math.max(0, idx), Math.max(pageCount - 1, 0))
    const ratio = pageOffsets[clamped] ?? 0
    set({ pageIdx: clamped, scrollRatio: ratio })
    advanceTo(ratio)
    void get().saveProgress()
  },

  setScrollRatio: (ratio) => {
    set({ scrollRatio: ratio })
    advanceTo(ratio)
    void get().saveProgress()
  },

  setPagination: (pageCount, offsets) => set({ pageCount, pageOffsets: offsets }),

  seek: async (ratio) => {
    const clamped = Math.min(1, Math.max(0, ratio))
    const { pageOffsets, pageCount } = get()
    let target = pageCount - 1
    for (let index = 0; index < pageOffsets.length; index += 1) {
      if (pageOffsets[index] > clamped) {
        target = index
        break
      }
    }
    set({ pageIdx: Math.max(target, 0), scrollRatio: clamped })
    advanceTo(clamped)
    void get().saveProgress()
  },

  jumpToRatio: async (chapterIdx, ratio) => {
    const bridge = window.toolbox
    if (!bridge) return
    const chapters = get().chapters
    if (chapterIdx < 0 || chapterIdx >= chapters.length) return

    const target = chapters[chapterIdx]
    const chapter = await bridge.books.chapterContent(target.id)
    const clamped = Math.min(1, Math.max(0, ratio))

    set({ chapter, chapterIdx, pageIdx: 0, scrollRatio: clamped })

    window.setTimeout(() => {
      const { pageOffsets, pageCount } = get()
      let page = pageCount - 1
      for (let index = 0; index < pageOffsets.length; index += 1) {
        if (pageOffsets[index] > clamped) {
          page = index
          break
        }
      }
      set({ pageIdx: Math.max(page, 0) })
      void get().saveProgress()
    }, 80)

    advanceTo(clamped)
  },

  jumpToBookmark: async (bookmark) => {
    await get().jumpToRatio(bookmark.chapterIdx, bookmark.pageIdxRatio)
  },

  toggleBookmark: async (input) => {
    const bridge = window.toolbox
    if (!bridge) return
    await bridge.bookmarks.toggle(input)
    set({ bookmarks: await bridge.bookmarks.list(input.bookId) })
  },

  deleteBookmark: async (id) => {
    const bridge = window.toolbox
    const book = get().book
    if (!bridge || !book) return
    await bridge.bookmarks.delete(id)
    set({ bookmarks: await bridge.bookmarks.list(book.id) })
  },

  saveProgress: async () => {
    const bridge = window.toolbox
    const { book, chapterIdx, bookPercent, chapters, scrollRatio } = get()
    if (!bridge || !book) return

    // 全书进度 = (当前章节序号 + 章内比例) / 总章节数
    const total = Math.max(chapters.length, 1)
    const percent = Math.min(1, (chapterIdx + scrollRatio) / total)
    if (Math.abs(percent - bookPercent) < 0.0005) return

    await bridge.books.progressSave({ bookId: book.id, chapterIdx, percent })
    set({ bookPercent: percent })
  },

  startStats: () => {
    if (statsTimer) clearInterval(statsTimer)
    let ticks = 0

    const flush = (): void => {
      if (pendingDurationMs <= 0 && pendingCharCount <= 0) return
      const durationMs = pendingDurationMs
      const charCount = pendingCharCount
      pendingDurationMs = 0
      pendingCharCount = 0
      void window.toolbox
        ?.stats.flush({ durationMs, charCount })
        .catch(() => undefined)
    }

    statsTimer = setInterval(() => {
      // 仅在窗口可见且聚焦时累计时长（对应旧项目 lifecycle resumed 判定）
      if (document.visibilityState === 'visible' && document.hasFocus()) {
        pendingDurationMs += 1000
      }
      ticks += 1
      if (ticks % STATS_FLUSH_TICKS === 0) flush()
    }, 1000)

    const onVisibility = (): void => {
      if (document.visibilityState === 'hidden') flush()
    }
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      if (statsTimer) clearInterval(statsTimer)
      statsTimer = null
      document.removeEventListener('visibilitychange', onVisibility)
      flush()
    }
  }
}))

/** 只计前进：回退不扣字数 */
function advanceTo(ratio: number): void {
  if (ratio > sessionMaxRatio) {
    pendingCharCount += Math.round((ratio - sessionMaxRatio) * 10000)
    sessionMaxRatio = ratio
  }
}