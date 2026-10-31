/** 与 notes:save 的标题上限一致，超长标题会整条保存失败。 */
const NOTE_TITLE_LIMIT = 60
/** 会话记录可能很长；超过后截断并标注，避免一条笔记塞进整段日志。 */
const NOTE_CONTENT_LIMIT = 20_000

export interface SessionNoteMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface SessionNoteInput {
  agentName: string
  sessionTitle: string
  directory: string
  messages: SessionNoteMessage[]
}

export interface SessionNoteDraft {
  title: string
  content: string
  /** 实际写入的记录条数（空消息已剔除）。 */
  count: number
}

function trimTitle(value: string): string {
  return value.length > NOTE_TITLE_LIMIT ? `${value.slice(0, NOTE_TITLE_LIMIT - 1)}…` : value
}

/**
 * 把整段编程会话整理成一条笔记：标题带 Agent 与会话名，正文按消息顺序标注发言者，
 * 空消息剔除；没有任何可用内容时返回 null。
 */
export function buildSessionNote(input: SessionNoteInput): SessionNoteDraft | null {
  const usable = input.messages.filter((message) => message.content.trim())
  if (!usable.length) return null
  const sessionTitle = input.sessionTitle.trim() || '编程会话'
  const header = [
    `# ${sessionTitle}`,
    '',
    `来源：${input.agentName}${input.directory ? ` · ${input.directory}` : ''}`,
    `共 ${usable.length} 条消息`,
    '',
    ''
  ].join('\n')
  const body = usable
    .map(
      (message) =>
        `## ${message.role === 'user' ? '你' : input.agentName}\n\n${message.content.trim()}`
    )
    .join('\n\n')
  const content = `${header}${body}`
  return {
    title: trimTitle(`${input.agentName} · ${sessionTitle}`),
    content:
      content.length > NOTE_CONTENT_LIMIT
        ? `${content.slice(0, NOTE_CONTENT_LIMIT)}…\n（会话较长，已截断）`
        : content,
    count: usable.length
  }
}
