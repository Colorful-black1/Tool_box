/**
 * 书架排序（界面层）。
 *
 * 抽成独立 `.ts` 而不是留在 `bookshelf-screen.tsx` 里：这是个纯函数，
 * 放在 `.tsx` 就没法在 vitest 的 node 环境里测（会连带解析 react-native）。
 * 数据层 `listBooks` 的 SQL 排序是固定的，这里在拿到结果后重排。
 */
import type { BookSummary } from '../../shared-bridge'

export type BookshelfSort = 'manual' | 'recentRead' | 'addedTime' | 'title'

export const SORT_OPTIONS: Array<{ value: BookshelfSort; label: string }> = [
  { value: 'manual', label: '手动' },
  { value: 'recentRead', label: '最近在读' },
  { value: 'addedTime', label: '加入时间' },
  { value: 'title', label: '书名' }
]

export function sortBooks(books: BookSummary[], mode: BookshelfSort): BookSummary[] {
  const sorted = [...books]
  switch (mode) {
    case 'manual':
      sorted.sort((a, b) => a.sortIndex - b.sortIndex)
      break
    case 'addedTime':
      sorted.sort((a, b) => b.createdAtMs - a.createdAtMs)
      break
    case 'title':
      sorted.sort((a, b) => a.title.localeCompare(b.title, 'zh-Hans-CN'))
      break
    case 'recentRead':
    default:
      sorted.sort((a, b) => {
        // 没读过的沉底；都没读过时退回手动序，保证顺序稳定不闪
        if (!a.progress && !b.progress) return a.sortIndex - b.sortIndex
        if (!a.progress) return 1
        if (!b.progress) return -1
        return b.progress.updatedAtMs - a.progress.updatedAtMs
      })
      break
  }
  return sorted
}
