import { intParam, optionalInt, optionalText, requireInt, requireText, textParam } from '../tool-registry'
import type { ToolFactory } from './deps'
import { resolveBook, resolveGroup } from './resolve'

/** 单次返回的正文上限，防止撑爆上下文（与桌面端一致） */
const DEFAULT_CHAPTER_CHARS = 4000
const MAX_CHAPTER_CHARS = 8000

export const bookTools: ToolFactory = ({ store }) => [
  {
    name: 'books_list',
    description:
      '列出书架中的小说，可按书名或作者关键词过滤。返回每本书的 ID、书名、作者、章节数与阅读进度。',
    parameters: {
      type: 'object',
      properties: { query: textParam('书名或作者关键词，留空返回全部', 60) }
    },
    risk: 'read',
    summarize: (_input, result) => `共 ${(result as unknown[]).length} 本书`,
    handler: async (input) => {
      const query = optionalText(input, 'query', '关键词', 60) ?? ''
      const books = await store.listBooks(query)
      return books.map((book) => ({
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
    description: '列出指定小说的章节目录（章节序号 idx 与标题）。读取正文前先调用它。',
    parameters: {
      type: 'object',
      properties: { book: textParam('书名或书籍 ID', 120) },
      required: ['book']
    },
    risk: 'read',
    summarize: (_input, result) => {
      const data = result as { book: { title: string }; chapters: unknown[] }
      return `《${data.book.title}》共 ${data.chapters.length} 章`
    },
    handler: async (input) => {
      const book = await resolveBook(store, requireText(input, 'book', '书名或书籍 ID', 120))
      const chapters = await store.listChapters(book.id)
      return {
        book: { id: book.id, title: book.title },
        chapters: chapters.map((chapter) => ({
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
    parameters: {
      type: 'object',
      properties: {
        book: textParam('书名或书籍 ID', 120),
        chapterIdx: intParam('章节序号 idx，从 0 开始', 0, 100_000),
        maxChars: intParam('正文截断长度', 200, MAX_CHAPTER_CHARS)
      },
      required: ['book', 'chapterIdx']
    },
    risk: 'read',
    summarize: (_input, result) => {
      const data = result as { book: { title: string }; chapterIdx: number; title: string }
      return `已读取《${data.book.title}》第 ${data.chapterIdx + 1} 章：${data.title}`
    },
    handler: async (input) => {
      const book = await resolveBook(store, requireText(input, 'book', '书名或书籍 ID', 120))
      const chapterIdx = requireInt(input, 'chapterIdx', '章节序号', 0, 100_000)
      const chapter = (await store.listChapters(book.id)).find((item) => item.idx === chapterIdx)
      if (!chapter) throw new Error(`未找到第 ${chapterIdx} 章`)
      const detail = await store.chapterContent(chapter.id)
      const limit = optionalInt(input, 'maxChars', '截断长度', 200, MAX_CHAPTER_CHARS)
      const max = limit ?? DEFAULT_CHAPTER_CHARS
      return {
        book: { id: book.id, title: book.title },
        chapterIdx,
        title: chapter.title,
        truncated: detail.content.length > max,
        content: detail.content.slice(0, max)
      }
    }
  },
  {
    name: 'books_set_group',
    description: '把某本小说归入某个分组；group 留空表示移出分组。',
    parameters: {
      type: 'object',
      properties: {
        book: textParam('书名或书籍 ID', 120),
        group: textParam('分组名称或 ID，留空表示移出分组', 40)
      },
      required: ['book']
    },
    risk: 'write',
    summarize: (_input, result) => {
      const data = result as { book: string; group: string | null }
      return data.group
        ? `已把《${data.book}》归入分组「${data.group}」`
        : `已将《${data.book}》移出分组`
    },
    handler: async (input) => {
      const book = await resolveBook(store, requireText(input, 'book', '书名或书籍 ID', 120))
      const groupRef = optionalText(input, 'group', '分组名称或 ID', 40)
      if (!groupRef) {
        await store.setBooksGroup([book.id], null)
        return { book: book.title, group: null }
      }
      const group = await resolveGroup(store, groupRef)
      await store.setBooksGroup([book.id], group.id)
      return { book: book.title, group: group.name }
    }
  }
]
