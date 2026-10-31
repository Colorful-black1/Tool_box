/** 记事本标题上限，与 notes:save 的入参校验保持一致。 */
const NOTE_TITLE_LIMIT = 60
/** 单条笔记正文上限；超出部分截断并标注，避免把整段日志塞进一条笔记。 */
const NOTE_CONTENT_LIMIT = 5000

export interface MessageNoteInput {
  content: string
  /** 来源说明，如「Claude Code · 修复 ABI 构建」。 */
  origin: string
}

export interface MessageNoteDraft {
  title: string
  content: string
}

/** 去掉 Markdown 标记后再决定标题，避免标题变成 `## 结论` 或 `- 步骤`。 */
function firstMeaningfulLine(body: string): string {
  const lines = body
    .split('\n')
    .map((line) => line.replace(/^[#>*+\-\s]+/, '').trim())
    .filter((line) => line.length > 0 && !line.startsWith('```'))
  return lines[0] ?? ''
}

function trimTitle(value: string): string {
  return value.length > NOTE_TITLE_LIMIT ? `${value.slice(0, NOTE_TITLE_LIMIT - 1)}…` : value
}

/**
 * 把一条对话消息整理成记事本草稿：标题取首行，正文保留原样并附来源。
 * 空内容返回 null，由调用方给出提示而不是写入空笔记。
 */
export function buildMessageNote(input: MessageNoteInput): MessageNoteDraft | null {
  const body = input.content.trim()
  if (!body) return null
  const origin = input.origin.replace(/\s+/g, ' ').trim()
  const fallback = origin ? `${origin} 摘录` : '对话摘录'
  const title = trimTitle(firstMeaningfulLine(body) || fallback)
  const truncated = body.length > NOTE_CONTENT_LIMIT
  const text = truncated ? `${body.slice(0, NOTE_CONTENT_LIMIT)}…\n（内容较长，已截断）` : body
  return { title, content: origin ? `${text}\n\n—— 来自 ${origin}` : text }
}
