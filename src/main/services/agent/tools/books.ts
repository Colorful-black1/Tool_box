import { statSync } from 'node:fs'
import { extname } from 'node:path'

import * as z from 'zod'

import type { ToolFactory } from './deps'
import { resolveBook, resolveGroup } from './resolve'

/** 导入体积上限，与手机端保持一致，避免主进程读入超大文件 */
const MAX_IMPORT_BYTES = 32 * 1024 * 1024
/** 单次返回的正文上限，防止撑爆上下文 */
const DEFAULT_CHAPTER_CHARS = 4000
const MAX_CHAPTER_CHARS = 8000

export const bookTools: ToolFactory = ({ store, importService }) => [
  {
    name: 'books_list',
    description:
      '列出书架中的小说，可按书名或作者关键词过滤。返回每本书的 ID、书名、作者、章节数与阅读进度。',
    schema: z.object({
      query: z.string().max(60).optional().describe('书名或作者关键词，留空返回全部')
    }),
    risk: 'read',
    summarize: (_input, result) => `共 ${(result as unknown[]).length} 本书`,
    handler: async (input) => {
      const query = typeof input.query === 'string' ? input.query : ''
      return store.listBooks(query).map((book) => ({
        id: book.id,
        title: book.title,
        author: book.author,
        chapterCount: book.chapterCount,
        groupId: book.groupId,
        progress: book.progress
          ? { chapterIdx: book.progress.chapterIdx, percent: book.progress.percent }
          : null
      }))
    }
  },
  {
    name: 'books_chapters',
    description: '列出指定小说的章节目录（章节序号 idx 与标题）。删除或定位章节前先调用它。',
    schema: z.object({
      book: z.string().max(120).describe('书名或书籍 ID')
    }),
    risk: 'read',
    summarize: (_input, result) => {
      const data = result as { book: { title: string }; chapters: unknown[] }
      return `《${data.book.title}》共 ${data.chapters.length} 章`
    },
    handler: async (input) => {
      const book = resolveBook(store, String(input.book ?? ''))
      return {
        book: { id: book.id, title: book.title },
        chapters: store.listChapters(book.id).map((chapter) => ({
          idx: chapter.idx,
          title: chapter.title,
          wordCount: chapter.wordCount
        }))
      }
    }
  },
  {
    name: 'books_chapter_content',
    description: '读取指定小说某一章的正文（可选截断长度）。用于总结、问答或引用内容。',
    schema: z.object({
      book: z.string().max(120).describe('书名或书籍 ID'),
      chapterIdx: z.number().int().min(0).describe('章节序号 idx，从 0 开始'),
      maxChars: z.number().int().min(200).max(MAX_CHAPTER_CHARS).optional()
    }),
    risk: 'read',
    summarize: (_input, result) => {
      const data = result as { book: { title: string }; chapterIdx: number; title: string }
      return `已读取《${data.book.title}》第 ${data.chapterIdx + 1} 章：${data.title}`
    },
    handler: async (input) => {
      const book = resolveBook(store, String(input.book ?? ''))
      const chapterIdx = Number(input.chapterIdx)
      const chapter = store.listChapters(book.id).find((item) => item.idx === chapterIdx)
      if (!chapter) throw new Error(`未找到第 ${chapterIdx} 章`)
      const content = store.chapterContent(chapter.id).content
      const limit =
        typeof input.maxChars === 'number' ? input.maxChars : DEFAULT_CHAPTER_CHARS
      return {
        book: { id: book.id, title: book.title },
        chapterIdx,
        title: chapter.title,
        truncated: content.length > limit,
        content: content.slice(0, limit)
      }
    }
  },
  {
    name: 'books_import_from_path',
    description:
      '从本机 TXT 文件路径导入一本小说到书架（自动探测编码并解析章节）。需要用户提供确切的文件路径。',
    schema: z.object({
      path: z.string().max(500).describe('TXT 文件的绝对路径')
    }),
    risk: 'write',
    summarize: (_input, result) => {
      const data = result as { title: string; chapterCount: number }
      return `已导入《${data.title}》，共 ${data.chapterCount} 章`
    },
    handler: async (input) => {
      const path = String(input.path ?? '').trim()
      if (!path) throw new Error('请提供文件路径')
      if (extname(path).toLowerCase() !== '.txt') throw new Error('仅支持 TXT 文件')
      const size = statSync(path).size
      if (size === 0) throw new Error('文件为空')
      if (size > MAX_IMPORT_BYTES) throw new Error('文件过大（超过 32MB）')
      const parsed = importService.parse(path)
      const book = store.importBook({
        title: parsed.title,
        author: '',
        chapters: parsed.chapters
      })
      return { id: book.id, title: book.title, chapterCount: book.chapterCount }
    }
  },
  {
    name: 'books_update_meta',
    description: '修改某本小说书名或作者。',
    schema: z.object({
      book: z.string().max(120).describe('书名或书籍 ID'),
      title: z.string().max(60).optional().describe('新书名'),
      author: z.string().max(30).optional().describe('新作者')
    }),
    risk: 'write',
    summarize: (input, result) => {
      const data = result as { title: string; author: string }
      if (typeof input.author === 'string' && input.title === undefined) {
        return `已把《${data.title}》的作者设为「${data.author}」`
      }
      if (typeof input.title === 'string' && input.author === undefined) {
        return `已把书名改为《${data.title}》`
      }
      return `已更新《${data.title}》的信息`
    },
    handler: async (input) => {
      const book = resolveBook(store, String(input.book ?? ''))
      const meta: { title?: string; author?: string } = {}
      if (typeof input.title === 'string') meta.title = input.title
      if (typeof input.author === 'string') meta.author = input.author
      if (meta.title === undefined && meta.author === undefined) {
        throw new Error('没有需要修改的字段')
      }
      const updated = store.updateBookMeta(book.id, meta)
      return { id: updated.id, title: updated.title, author: updated.author }
    }
  },
  {
    name: 'books_set_group',
    description: '把某本小说归入某个分组；group 传空字符串表示移出分组。',
    schema: z.object({
      book: z.string().max(120).describe('书名或书籍 ID'),
      group: z.string().max(40).describe('分组名称或 ID，空字符串表示移出分组')
    }),
    risk: 'write',
    summarize: (_input, result) => {
      const data = result as { book: string; group: string | null }
      return data.group
        ? `已把《${data.book}》归入分组「${data.group}」`
        : `已将《${data.book}》移出分组`
    },
    handler: async (input) => {
      const book = resolveBook(store, String(input.book ?? ''))
      const groupRef = String(input.group ?? '').trim()
      if (!groupRef) {
        store.setBooksGroup([book.id], null)
        return { book: book.title, group: null }
      }
      const group = resolveGroup(store, groupRef)
      store.setBooksGroup([book.id], group.id)
      return { book: book.title, group: group.name }
    }
  },
  {
    name: 'books_delete',
    description: '删除一本小说及其全部章节、书签与阅读进度。此操作不可撤销。',
    schema: z.object({
      book: z.string().max(120).describe('书名或书籍 ID')
    }),
    risk: 'destructive',
    summarize: (_input, result) => `已删除《${(result as { deleted: string }).deleted}》`,
    handler: async (input) => {
      const book = resolveBook(store, String(input.book ?? ''))
      store.deleteBook(book.id)
      return { deleted: book.title }
    }
  }
]
