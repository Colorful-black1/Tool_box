/** 与 notes:save 的标题上限一致，超长标题会整条保存失败。 */
const NOTE_TITLE_LIMIT = 60
/** 周报条目上限：超出后只列前 N 条，避免一条笔记塞进整周 backlog。 */
const MAX_ITEMS = 60
const NOTE_CONTENT_LIMIT = 5000

export interface TodoDigestItem {
  title: string
  completedAtMs: number | null
}

export interface TodoDigest {
  title: string
  content: string
  /** 本周完成的条目总数（含未列出的部分）。 */
  count: number
}

/** 本周一 00:00（本机时区）；周日算上一周的末尾。 */
export function startOfWeekMs(nowMs: number): number {
  const date = new Date(nowMs)
  date.setHours(0, 0, 0, 0)
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7))
  return date.getTime()
}

function monthDay(ms: number): string {
  const date = new Date(ms)
  return `${date.getMonth() + 1}/${date.getDate()}`
}

function trimTitle(value: string): string {
  return value.length > NOTE_TITLE_LIMIT ? `${value.slice(0, NOTE_TITLE_LIMIT - 1)}…` : value
}

/**
 * 把一周内完成的待办整理成一条周报笔记；本周没有完成记录时返回 null。
 * 只读已完成条目，不改待办本身，也不按笔记来源回写。
 */
export function buildTodoDigest(items: TodoDigestItem[], nowMs: number): TodoDigest | null {
  const since = startOfWeekMs(nowMs)
  const done: { title: string; completedAtMs: number }[] = []
  for (const item of items) {
    if (item.completedAtMs === null) continue
    if (item.completedAtMs < since || item.completedAtMs > nowMs) continue
    done.push({ title: item.title, completedAtMs: item.completedAtMs })
  }
  if (!done.length) return null
  done.sort((left, right) => left.completedAtMs - right.completedAtMs)

  const weekEnd = new Date(since)
  weekEnd.setDate(weekEnd.getDate() + 6)
  const shown = done.slice(0, MAX_ITEMS)
  const lines = shown.map(
    (item) => `- ${item.title.trim() || '（无标题）'}（${monthDay(item.completedAtMs)}）`
  )
  if (done.length > shown.length) lines.push(`- 其余 ${done.length - shown.length} 条未列出`)

  const body = [
    `本周完成 ${done.length} 条。`,
    '',
    ...lines,
    '',
    `—— 待办清单 · ${monthDay(since)} 至 ${monthDay(weekEnd.getTime())}`
  ].join('\n')
  return {
    title: trimTitle(
      `周报 · ${monthDay(since)}–${monthDay(weekEnd.getTime())} · 完成 ${done.length} 条`
    ),
    content:
      body.length > NOTE_CONTENT_LIMIT
        ? `${body.slice(0, NOTE_CONTENT_LIMIT)}…\n（内容较长，已截断）`
        : body,
    count: done.length
  }
}
