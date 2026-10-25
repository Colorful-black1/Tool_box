import * as z from 'zod'
import { compareText } from '../../../../shared/diff-tools'
import type { NoteView } from '../../../../shared/types'
import type { ToolFactory } from './deps'
import type { PreparedAgentTool } from '../tool-registry'
import { resolveNote } from './resolve'

const editSchema = z.object({
  note: z.string().min(1).max(120).describe('笔记标题或查询得到的 ID'),
  operation: z.enum(['append', 'replace', 'rename']),
  text: z.string().max(20000).optional().describe('追加的内容，或需唯一匹配的完整原文片段'),
  replacement: z.string().max(20000).optional().describe('replace 时的新片段，可为空以移除片段'),
  title: z.string().min(1).max(60).optional().describe('rename 时的新标题')
})

export const noteEditTools: ToolFactory = ({ store }) => {
  const prepare = async (input: Record<string, unknown>): Promise<PreparedAgentTool> => {
    const data = editSchema.parse(input)
    const before = { ...resolveNote(store, data.note) }
    let title = before.title
    let content = before.content
    if (content.length > 20000) throw new Error('笔记超过局部编辑预览上限，请在记事本页面编辑')
    if (data.operation === 'rename') {
      if (!data.title?.trim()) throw new Error('请提供新标题')
      title = data.title.trim()
    } else {
      if (!data.text?.trim()) throw new Error('请提供非空的追加内容或原文片段')
      if (data.operation === 'append')
        content += `${content && !content.endsWith('\n') ? '\n' : ''}${data.text}`
      else {
        if (data.replacement === undefined) throw new Error('请提供替换后的片段')
        const start = content.indexOf(data.text)
        if (start < 0) throw new Error('原文片段不存在，请重新读取笔记')
        if (content.indexOf(data.text, start + 1) >= 0)
          throw new Error('原文片段匹配到多处，请提供更完整的唯一片段')
        content =
          content.slice(0, start) + data.replacement + content.slice(start + data.text.length)
      }
    }
    if (content.length > 20000) throw new Error('修改后的笔记超过 20000 字符，请缩小修改范围')
    if (title === before.title && content === before.content)
      throw new Error('内容没有变化，无需保存')
    const diff = compareText(before.content, content)
    const lines = diff.lines.map(
      (line) =>
        `${line.kind === 'added' ? '+' : line.kind === 'removed' ? '-' : ' '} ${line.beforeLine ?? ''}:${line.afterLine ?? ''} ${line.text}`
    )
    const args = `笔记局部编辑：${before.title || '未命名笔记'}\n标题：${before.title} → ${title}\n以下 - 为删除、+ 为新增，其余为保留${diff.coarse ? '（大文本按区块比较）' : ''}：\n${lines.join('\n')}`
    if (args.length > 80000) throw new Error('差异行数过多，请在记事本页面核对并编辑')
    return {
      requireApproval: true,
      args,
      execute: async () => {
        const current = store.listNotes().find((item) => item.id === before.id)
        if (
          !current ||
          current.updatedAtMs !== before.updatedAtMs ||
          current.title !== before.title ||
          current.content !== before.content
        )
          throw new Error('笔记已变化或被删除，请重新读取并核对差异')
        const saved = store.saveNote({ id: before.id, title, content })
        return { id: saved.id, title: saved.title }
      }
    }
  }
  return [
    {
      name: 'notes_edit',
      description:
        '局部编辑已有笔记：append 追加、replace 唯一原文片段替换、rename 改名。保留其他内容；修改前始终展示差异并请求确认，确认期间原文变化则拒绝写入。不要用 notes_save 代替用户要求的局部修改。',
      schema: editSchema,
      risk: 'write',
      prepare,
      handler: async (input) => (await prepare(input)).execute(),
      summarize: (_input, result) => `已更新笔记「${(result as Pick<NoteView, 'title'>).title}」`,
      references: (_input, result) => [
        {
          label: `笔记「${(result as Pick<NoteView, 'title'>).title}」`,
          target: { kind: 'note', id: (result as Pick<NoteView, 'id'>).id }
        }
      ]
    }
  ]
}
