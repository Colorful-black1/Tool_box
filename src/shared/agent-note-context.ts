/**
 * 把记事本条目整理成可直接粘进编程 Agent 草稿的上下文文本。
 * 纯逻辑，不依赖 DOM / Node，便于单测。
 */

/** 单条笔记插入草稿的上限，避免一条长笔记挤掉任务描述。 */
const NOTE_CONTEXT_LIMIT = 2000

export interface NoteContextInput {
  title: string
  content: string
}

/**
 * 笔记为空时返回 null，调用方应提示「该笔记没有内容」而不是插入一个空标题。
 */
export function buildNoteContext(input: NoteContextInput): string | null {
  const content = input.content.trim()
  if (!content) return null
  const title = input.title.trim()
  const truncated = content.length > NOTE_CONTEXT_LIMIT
  const body = truncated ? `${content.slice(0, NOTE_CONTEXT_LIMIT)}…` : content
  const head = title ? `【记事本：${title}】` : '【记事本摘录】'
  return `${head}\n${body}${truncated ? '\n（内容较长，已截断）' : ''}`
}
