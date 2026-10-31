/** 与 notes:save 的标题上限一致，超长标题会整条保存失败。 */
const NOTE_TITLE_LIMIT = 60

export interface MergeNoteInput {
  title: string
  content: string
}

export interface MergedNote {
  title: string
  content: string
}

function trimTitle(value: string): string {
  return value.length > NOTE_TITLE_LIMIT ? `${value.slice(0, NOTE_TITLE_LIMIT - 1)}…` : value
}

function section(note: MergeNoteInput): string {
  const title = note.title.trim() || '（无标题）'
  const body = note.content.trim()
  return body ? `## ${title}\n\n${body}` : `## ${title}`
}

/**
 * 多条笔记合成一条：标题取第一条标题加「等 N 条」，正文按顺序保留各自标题。
 * 少于两条可合并的笔记返回 null，避免把单条笔记原样复制一份。
 */
export function mergeNotes(notes: MergeNoteInput[]): MergedNote | null {
  const usable = notes.filter((note) => note.title.trim() || note.content.trim())
  if (usable.length < 2) return null
  const base = usable[0].title.trim() || '合并笔记'
  return {
    title: trimTitle(`${base} 等 ${usable.length} 条`),
    content: usable.map(section).join('\n\n---\n\n')
  }
}
