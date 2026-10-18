import { optionalText, requireText, textParam } from '../tool-registry'
import type { ToolFactory } from './deps'
import { resolveNote } from './resolve'

/** 单次返回的笔记正文上限（与桌面端一致） */
const NOTE_PREVIEW_CHARS = 4000
/** 单次写入的笔记正文上限（与桌面端 zod 的 .max(20000) 对齐） */
const NOTE_MAX_INPUT_CHARS = 20_000

export const noteTools: ToolFactory = ({ store }) => [
  {
    name: 'notes_list',
    description: '列出记事本中的全部笔记（标题、更新时间与正文摘要）。',
    parameters: { type: 'object', properties: {} },
    risk: 'read',
    summarize: (_input, result) => `共 ${(result as unknown[]).length} 篇笔记`,
    handler: async () => {
      const notes = await store.listNotes()
      return notes.map((note) => ({
        id: note.id,
        title: note.title,
        updatedAtMs: note.updatedAtMs,
        preview: note.content.slice(0, 60)
      }))
    }
  },
  {
    name: 'notes_get',
    description: '读取一篇笔记的完整正文。',
    parameters: {
      type: 'object',
      properties: { note: textParam('笔记标题或 ID', 120) },
      required: ['note']
    },
    risk: 'read',
    summarize: (_input, result) => `已读取笔记《${(result as { title: string }).title}》`,
    handler: async (input) => {
      const note = await resolveNote(store, requireText(input, 'note', '笔记标题或 ID', 120))
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
    description: '新建或覆盖一篇笔记。传入 note（标题或 ID）表示更新已有笔记；不传则新建。',
    parameters: {
      type: 'object',
      properties: {
        title: textParam('笔记标题', 60),
        content: textParam('Markdown 正文', NOTE_MAX_INPUT_CHARS),
        note: textParam('要更新的笔记标题或 ID，留空则新建', 120)
      },
      required: ['title', 'content']
    },
    risk: 'write',
    summarize: (_input, result) => {
      const data = result as { title: string; updated: boolean }
      return `已${data.updated ? '更新' : '新建'}笔记《${data.title}》`
    },
    handler: async (input) => {
      const title = requireText(input, 'title', '笔记标题', 60)
      const content = requireText(input, 'content', '笔记正文', NOTE_MAX_INPUT_CHARS)
      const ref = optionalText(input, 'note', '笔记标题或 ID', 120)
      const id = ref ? (await resolveNote(store, ref)).id : undefined
      const saved = await store.saveNote({ id, title, content })
      return { id: saved.id, title: saved.title, updated: id !== undefined }
    }
  }
]
