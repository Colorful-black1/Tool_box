import { useCallback, useState } from 'react'
import type { ReactNode } from 'react'

import { Screen } from '../components/screen'
import { useQuickActionSignal } from '../navigation/use-quick-action'
import { BookReaderScreen } from '../ui/reader/book-reader-screen'
import { BookshelfScreen } from '../ui/reader/bookshelf-screen'
import { ReadingStatsScreen } from '../ui/reader/reading-stats-screen'
import type { BookSummary } from '../shared-bridge'

/**
 * 书架页（M4）：书架列表 / 阅读器 / 统计三层，同样用本地 state 切换，
 * 不引第二套导航栈 —— 与对话页、记事本页保持同一取舍。
 *
 * 阅读器会把进度写回 `books.reading_progress`，因此从阅读器返回时
 * `reloadSignal` 加一，让书架重读一次，进度条才是最新的。
 */
export function ShelfScreen(): ReactNode {
  const [book, setBook] = useState<BookSummary | null>(null)
  const [reading, setReading] = useState(false)
  const [statsOpen, setStatsOpen] = useState(false)
  const [reloadSignal, setReloadSignal] = useState(0)
  /** 长按 Tab「书架」→ 直接走导入流程（导入逻辑在书架页里） */
  const createSignal = useQuickActionSignal()

  const leaveReader = useCallback(() => {
    setReading(false)
    setBook(null)
    setReloadSignal((value) => value + 1)
  }, [])

  if (statsOpen) {
    return (
      <Screen>
        <ReadingStatsScreen onBack={() => setStatsOpen(false)} />
      </Screen>
    )
  }

  if (reading && book) {
    return (
      <Screen>
        <BookReaderScreen book={book} onBack={leaveReader} />
      </Screen>
    )
  }

  return (
    <Screen>
      <BookshelfScreen
        reloadSignal={reloadSignal}
        createSignal={createSignal}
        onOpenBook={(target) => {
          setBook(target)
          setReading(true)
        }}
        onOpenStats={() => setStatsOpen(true)}
      />
    </Screen>
  )
}
