/**
 * 编程会话正文的分页、合并与存储裁剪。
 *
 * 界面只接收最近一页，向上滚动时按 `seq` 回取更早的页；主进程保留完整正文，
 * 只有超过存储预算才丢弃最旧的消息，并把丢弃条数显式上报，不静默吞内容。
 * 纯函数，主进程与渲染层共用。
 */

/** 一条可显示的会话消息；`seq` 由主进程分配，旧桥接可能缺失。 */
export interface SessionMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  seq?: number
}

/** 每页条数；工具输出单条可能很长，所以同时受字符预算约束。 */
export const MESSAGE_PAGE_COUNT = 40
/** 每页字符预算：约 30k 字，足够一屏工具输出又不会撑爆 IPC。 */
export const MESSAGE_PAGE_CHARS = 30_000
/** 主进程保留的会话条数上限，超出后从最旧开始丢弃。 */
export const SESSION_KEEP_COUNT = 4_000
/** 主进程保留的会话字符上限，约 4M。 */
export const SESSION_KEEP_CHARS = 4_000_000

export interface MessagePage<T extends SessionMessage = SessionMessage> {
  messages: T[]
  hasMore: boolean
}

function totalChars(messages: SessionMessage[]): number {
  let total = 0
  for (const message of messages) total += message.content.length
  return total
}

/**
 * 取最近一页：从尾部向前累计，条数或字符先到者为准，至少保留 1 条。
 * 单条超长消息不会把自己挤掉，否则流式输出会整段消失。
 */
export function takeTailPage<T extends SessionMessage>(
  messages: T[],
  maxCount = MESSAGE_PAGE_COUNT,
  maxChars = MESSAGE_PAGE_CHARS
): MessagePage<T> {
  if (!messages.length) return { messages: [], hasMore: false }
  let start = messages.length
  let chars = 0
  while (start > 0) {
    const next = messages[start - 1]
    const size = next.content.length
    if (start < messages.length && (messages.length - start >= maxCount || chars + size > maxChars))
      break
    start -= 1
    chars += size
    if (messages.length - start >= maxCount) break
  }
  return { messages: messages.slice(start), hasMore: start > 0 }
}

/**
 * 取 `beforeSeq` 之前的一页。
 *
 * 游标缺失（旧桥接没有 seq）或找不到对应消息时按空页处理，避免重复渲染。
 */
export function takePageBefore<T extends SessionMessage>(
  messages: T[],
  beforeSeq: number,
  maxCount = MESSAGE_PAGE_COUNT,
  maxChars = MESSAGE_PAGE_CHARS
): MessagePage<T> {
  const index = messages.findIndex((message) => (message.seq ?? -1) >= beforeSeq)
  const end = index === -1 ? 0 : index
  if (end <= 0) return { messages: [], hasMore: false }
  let start = end
  let chars = 0
  while (start > 0) {
    const next = messages[start - 1]
    const size = next.content.length
    if (start < end && (end - start >= maxCount || chars + size > maxChars)) break
    start -= 1
    chars += size
    if (end - start >= maxCount) break
  }
  return { messages: messages.slice(start, end), hasMore: start > 0 }
}

/**
 * 合并"已加载的更早页"和"事件推送的尾页"。
 *
 * 按 id 去重、保持先来后到：重读历史或流式更新时不会出现重复气泡。
 */
export function mergeSessionMessages<T extends SessionMessage>(
  older: T[],
  newer: T[]
): T[] {
  const seen = new Set<string>()
  const merged: T[] = []
  for (const message of [...older, ...newer]) {
    if (!message.id || seen.has(message.id)) continue
    seen.add(message.id)
    merged.push(message)
  }
  return merged
}

/**
 * 超出存储预算时从最旧开始丢弃，至少保留 1 条。
 *
 * 返回丢弃条数；调用方累加到 `truncatedMessages` 并在界面显式提示。
 */
export function trimOldestMessages<T extends SessionMessage>(
  messages: T[],
  maxCount = SESSION_KEEP_COUNT,
  maxChars = SESSION_KEEP_CHARS
): { messages: T[]; dropped: number } {
  if (messages.length <= 1) return { messages, dropped: 0 }
  let start = 0
  let chars = totalChars(messages)
  while (start < messages.length - 1) {
    if (messages.length - start <= maxCount && chars <= maxChars) break
    chars -= messages[start].content.length
    start += 1
  }
  return start === 0 ? { messages, dropped: 0 } : { messages: messages.slice(start), dropped: start }
}
