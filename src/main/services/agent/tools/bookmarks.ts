import * as z from 'zod'

import type { ToolFactory } from './deps'
import { resolveBook } from './resolve'

export const bookmarkTools: ToolFactory = ({ store }) => [
  {
    name: 'bookmarks_list',
    description: '列出某本小说的全部书签（章节序号、页码与片段）。',
    schema: z.object({
      book: z.string().max(120).describe('书名或书籍 ID')
    }),
    risk: 'read',
    summarize: (_input, result) => {
      const data = result as { book: { title: string }; bookmarks: unknown[] }
      return `《${data.book.title}》共 ${data.bookmarks.length} 个书签`
    },
    handler: async (input) => {
      const book = resolveBook(store, String(input.book ?? ''))
      return {
        book: { id: book.id, title: book.title },
        bookmarks: store.listBookmarks(book.id).map((bookmark) => ({
          id: bookmark.id,
          chapterIdx: bookmark.chapterIdx,
          pageIdx: bookmark.pageIdx,
          snippet: bookmark.snippet
        }))
      }
    }
  },
  {
    name: 'bookmarks_delete',
    description: '删除一个书签。需要先通过 bookmarks_list 获取书签 ID。',
    schema: z.object({
      id: z.string().max(64).describe('书签 ID')
    }),
    risk: 'destructive',
    summarize: () => '已删除书签',
    handler: async (input) => {
      store.deleteBookmark(String(input.id ?? ''))
      return { deleted: true }
    }
  }
]
