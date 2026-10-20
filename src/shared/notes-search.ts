/**
 * 笔记搜索（两端共用）。
 *
 * 为什么单独抽出来：`notes_list` 只回标题 + 前 60 字预览，
 * AI 在长笔记里**搜不到正文里的内容**；搜索逻辑要两端一致，
 * 所以放 shared 由两端各调一次，而不是各写一份。
 *
 * 匹配规则：标题或正文包含关键词即命中（大小写不敏感）；
 * 标题命中排在正文命中之前，同类按更新时间倒序（新的更有用）。
 */
import type { NoteView } from './types'

/** 一条命中结果 */
export interface NoteSearchHit {
  id: string
  title: string
  updatedAtMs: number
  /** 命中位置附近的正文片段（标题命中时给正文开头预览） */
  snippet: string
  /** 命中在标题还是正文 */
  matchedIn: 'title' | 'content'
}

/** 命中位置前后各取多少字符 */
const SNIPPET_RADIUS = 40

export function searchNotes(
  notes: NoteView[],
  rawQuery: string,
  limit = 10
): NoteSearchHit[] {
  const query = rawQuery.trim().toLowerCase()
  if (!query) return []

  const hits: NoteSearchHit[] = []

  for (const note of notes) {
    const title = note.title ?? ''
    const content = note.content ?? ''

    if (title.toLowerCase().includes(query)) {
      hits.push({
        id: note.id,
        title,
        updatedAtMs: note.updatedAtMs,
        snippet: buildSnippet(content, -1, query.length, title),
        matchedIn: 'title'
      })
      continue
    }

    const index = content.toLowerCase().indexOf(query)
    if (index < 0) continue
    hits.push({
      id: note.id,
      title,
      updatedAtMs: note.updatedAtMs,
      snippet: buildSnippet(content, index, query.length, title),
      matchedIn: 'content'
    })
  }

  hits.sort((left, right) => {
    const leftIsTitle = left.matchedIn === 'title'
    const rightIsTitle = right.matchedIn === 'title'
    if (leftIsTitle !== rightIsTitle) return leftIsTitle ? -1 : 1
    return right.updatedAtMs - left.updatedAtMs
  })

  return hits.slice(0, Math.max(1, limit))
}

/** 取命中位置附近的片段；index 为 -1 表示标题命中，给正文开头预览 */
function buildSnippet(
  content: string,
  index: number,
  length: number,
  fallbackTitle: string
): string {
  if (index < 0) {
    return collapse(content.slice(0, 80)) || fallbackTitle
  }
  const start = Math.max(0, index - SNIPPET_RADIUS)
  const end = index + length + SNIPPET_RADIUS
  const prefix = start > 0 ? '…' : ''
  const suffix = end < content.length ? '…' : ''
  return `${prefix}${collapse(content.slice(start, end))}${suffix}`
}

function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}
