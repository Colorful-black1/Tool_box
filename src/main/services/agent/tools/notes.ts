import * as z from 'zod'

import type { ToolFactory } from './deps'
import { resolveNote } from './resolve'

/** 单次返回的笔记正文上限 */
const NOTE_PREVIEW_CHARS = 4000

export const noteTools: ToolFactory = ({ store }) => [
  {
    name: 'notes_list',
    description: '列出记事本中的全部笔记（标题、更新时间与正文摘要）。',
    schema: z.object({}),
    risk: 'read',
    summarize: (_input, result) => `共 ${(result as unknown[]).length} 篇笔记`,
    handler: async () =>
      store.listNotes().map((note) => ({
        id: note.id,
        title: note.title,
        updatedAtMs: note.updatedAtMs,
        preview: note.content.slice(0, 60)
      }))
  },
  {
    name: 'notes_get',
    description: '读取一篇笔记的完整正文。',
    schema: z.object({
      note: z.string().max(120).describe('笔记标题或 ID')
    }),
    risk: 'read',
    summarize: (_input, result) => `已读取笔记《${(result as { title: string }).title}》`,
    handler: async (input) => {
      const note = resolveNote(store, String(input.note ?? ''))
      return {
        id: note.id,
        title: note.title,
        truncated: note.content.length > NOTE_PREVIEW_CHARS,
        content: note.content.slice(0, NOTE_PREVIEW_CHARS)
      }
    }
  },
  {
    name: 'notes_save',
    description:
      '新建或覆盖一篇笔记。传入 note（标题或 ID）表示更新已有笔记；不传则新建。',
    schema: z.object({
      title: z.string().max(60).describe('笔记标题'),
      content: z.string().max(20000).describe('Markdown 正文'),
      note: z.string().max(120).optional().describe('要更新的笔记标题或 ID，留空则新建')
    }),
    risk: 'write',
    summarize: (_input, result) => {
      const data = result as { title: string; updated: boolean }
      return `已${data.updated ? '更新' : '新建'}笔记《${data.title}》`
    },
    handler: async (input) => {
      const title = String(input.title ?? '')
      const content = String(input.content ?? '')
      let id: string | undefined
      if (typeof input.note === 'string' && input.note.trim()) {
        id = resolveNote(store, input.note).id
      }
      const saved = store.saveNote({ id, title, content })
      return { id: saved.id, title: saved.title, updated: id !== undefined }
    }
  },
  {
    name: 'notes_delete',
    description: '删除一篇笔记。此操作不可撤销。',
    schema: z.object({
      note: z.string().max(120).describe('笔记标题或 ID')
    }),
    risk: 'destructive',
    summarize: (_input, result) => {
      const data = result as { deleted: string }
      return `已删除笔记《${data.deleted || '未命名'}》`
    },
    handler: async (input) => {
      const note = resolveNote(store, String(input.note ?? ''))
      store.deleteNote(note.id)
      return { deleted: note.title }
    }
  }
]
