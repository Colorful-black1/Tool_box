import * as z from 'zod'
import { searchNotes } from '../../../../shared/notes-search'
import type { AppReference, AppTarget } from '../../../../shared/app-reference'
import type { ToolFactory } from './deps'
import { resolveBook, resolveGroup, resolveNote } from './resolve'
import { requireString } from '../../../ipc/validation'

/** 跨模块搜索只回可辨认的片段和本地打开目标。 */
interface SearchItem {
  title: string
  snippet: string
  target: AppTarget
}

/** 对话跨域搜索不包含密码箱、聊天历史或小说全文。 */
export const workspaceTools: ToolFactory = ({ store, todos }) => [
  {
    name: 'workspace_search',
    description:
      '一次搜索笔记标题／正文、全部状态的待办标题／备注、书名／作者和分组。结果带来源、总数和打开入口，不搜密码箱或聊天历史。',
    schema: z.object({
      query: z.string().min(1).max(60),
      domains: z
        .array(z.enum(['notes', 'todos', 'books', 'groups']))
        .min(1)
        .max(4)
        .optional(),
      limitPerDomain: z.number().int().min(1).max(10).optional()
    }),
    risk: 'read',
    handler: async (input) => {
      const query = requireString(input.query, '搜索关键词', { maxLength: 60 }).trim()
      if (!query) throw new Error('请提供搜索关键词')
      const domains = z
        .array(z.enum(['notes', 'todos', 'books', 'groups']))
        .min(1)
        .max(4)
        .parse(input.domains ?? ['notes', 'todos', 'books', 'groups'])
      const limit = z
        .number()
        .int()
        .min(1)
        .max(10)
        .parse(input.limitPerDomain ?? 5)
      const keyword = query.toLowerCase()
      const results: Array<{
        domain: string
        total: number
        truncated: boolean
        items: SearchItem[]
      }> = []
      const add = (domain: string, total: number, items: SearchItem[]): void => {
        results.push({ domain, total, truncated: total > items.length, items })
      }
      for (const domain of new Set(domains)) {
        if (domain === 'notes') {
          const notes = store.listNotes()
          const found = searchNotes(notes, query, limit)
          const total = notes.filter(
            (note) =>
              note.title.toLowerCase().includes(keyword) ||
              note.content.toLowerCase().includes(keyword)
          ).length
          add(
            domain,
            total,
            found.map((note) => ({
              title: note.title,
              snippet: note.snippet,
              target: { kind: 'note', id: note.id }
            }))
          )
        } else if (domain === 'books') {
          const books = store.listBooks(query)
          add(
            domain,
            books.length,
            books.slice(0, limit).map((book) => ({
              title: book.title,
              snippet: `作者：${book.author || '未填写'}；${book.chapterCount} 章`,
              target: { kind: 'book', id: book.id }
            }))
          )
        } else if (domain === 'groups') {
          const groups = store
            .listGroups()
            .filter((group) => group.name.toLowerCase().includes(keyword))
          add(
            domain,
            groups.length,
            groups.slice(0, limit).map((group) => ({
              title: group.name,
              snippet: '书架分组',
              target: { kind: 'group', id: group.id }
            }))
          )
        } else {
          if (!todos) throw new Error('当前待办服务未就绪，请重启应用')
          const pages = (['all', 'completed', 'archived'] as const).map((filter) =>
            todos.list({ filter, search: query, offset: 0, limit })
          )
          const items = pages.flatMap((page) => page.items).slice(0, limit)
          add(
            domain,
            pages.reduce((sum, page) => sum + page.total, 0),
            items.map((item) => ({
              title: item.title,
              snippet: `${item.archivedAtMs !== null ? '已归档' : item.completedAtMs !== null ? '已完成' : '未完成'}：${item.details.slice(0, 180)}`,
              target: { kind: 'todo', id: item.id }
            }))
          )
        }
      }
      return { query, results }
    },
    references: (_input, result) =>
      (result as { results: Array<{ items: SearchItem[] }> }).results.flatMap((group) =>
        group.items.map((item) => ({ label: item.title, target: item.target }))
      )
  },
  {
    name: 'workspace_open',
    description:
      '为用户提供应用内打开入口；只准备按钮，由用户点击打开，不自动切页。支持笔记、待办、书籍、具体章节与分组；todo 必须使用确切 ID。',
    schema: z.object({
      kind: z.enum(['note', 'todo', 'book', 'group']),
      ref: z.string().min(1).max(120),
      chapterIdx: z.number().int().min(0).optional().describe('仅 book 可用，从 0 开始；先查询目录')
    }),
    risk: 'read',
    handler: async (input) => {
      const kind = z.enum(['note', 'todo', 'book', 'group']).parse(input.kind)
      const ref = requireString(input.ref, '对象名称或 ID', { maxLength: 120 })
      let target: AppTarget
      let label: string
      if (kind !== 'book' && input.chapterIdx !== undefined) throw new Error('只有书籍支持章节定位')
      if (kind === 'note') {
        const note = resolveNote(store, ref)
        target = { kind, id: note.id }
        label = note.title || '未命名笔记'
      } else if (kind === 'group') {
        const group = resolveGroup(store, ref)
        target = { kind, id: group.id }
        label = group.name
      } else if (kind === 'todo') {
        if (!todos) throw new Error('当前待办服务未就绪')
        const todo = todos.get(ref)
        target = { kind, id: todo.id }
        label = todo.title
      } else {
        const book = resolveBook(store, ref)
        target = { kind, id: book.id }
        label = book.title
        if (input.chapterIdx !== undefined) {
          const chapterIdx = z.number().int().min(0).parse(input.chapterIdx)
          const chapter = store.listChapters(book.id).find((item) => item.idx === chapterIdx)
          if (!chapter) throw new Error('章节不存在，请重新查询目录')
          target = { kind: 'chapter', id: book.id, chapterIdx }
          label += ` · ${chapter.title}`
        }
      }
      return { label, target }
    },
    references: (_input, result) => [result as AppReference]
  }
]
