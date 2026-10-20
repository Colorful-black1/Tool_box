import { requireText, textParam } from '../tool-registry'
import type { ToolFactory } from './deps'
import { resolveBook } from './resolve'

/**
 * 书签（只读）。
 *
 * 桌面端还有 `bookmarks_delete`；手机端暂不给删除：
 * 书签是阅读进度的一部分，误删的代价比重新打一次书签高，
 * 而手机端阅读器里就能删。
 */
export const bookmarkTools: ToolFactory = ({ store }) => [
  {
    name: 'bookmarks_list',
    description: '列出某本小说的全部书签（章节序号、页码与片段）。',
    parameters: {
      type: 'object',
      properties: { book: textParam('书名或书籍 ID', 120) },
      required: ['book']
    },
    risk: 'read',
    summarize: (_input, result) => {
      const data = result as { book: { title: string }; bookmarks: unknown[] }
      return `《${data.book.title}》共 ${data.bookmarks.length} 个书签`
    },
    handler: async (input) => {
      const book = await resolveBook(store, requireText(input, 'book', '书名或书籍 ID', 120))
      const bookmarks = await store.listBookmarks(book.id)
      return {
        book: { id: book.id, title: book.title },
        bookmarks: bookmarks.map((bookmark) => ({
          id: bookmark.id,
          chapterIdx: bookmark.chapterIdx,
          pageIdx: bookmark.pageIdx,
          snippet: bookmark.snippet
        }))
      }
    }
  }
]
