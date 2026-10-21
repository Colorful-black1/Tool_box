/**
 * 全局搜索的纯逻辑：桌面端与手机端共用。
 *
 * 数据来源是应用内存里已经加载好的内容（书、笔记、密码、分组、会话），
 * 所以搜索**不发任何请求、不碰数据库**，输入即出结果。
 *
 * 打分规则很简单，够用即可：
 * - 标题前缀命中 > 标题包含 > 副标题包含 > 正文/关键词包含；
 * - 多个关键词之间是「与」关系（都命中才算命中）；
 * - 同分时按类型顺序（命令 → 工具 → 书架 → 记事本 → 密码箱 → 分组 → 会话）。
 */

/** 可被搜到的对象类型 */
export type SearchKind =
  | 'command'
  | 'tool'
  | 'book'
  | 'note'
  | 'password'
  | 'group'
  | 'conversation'

/** 各类型的中文标签与展示顺序 */
export const SEARCH_KIND_LABELS: Record<SearchKind, string> = {
  command: '命令',
  tool: '工具',
  book: '书架',
  note: '记事本',
  password: '密码箱',
  group: '分组',
  conversation: '会话'
}

const KIND_ORDER: Record<SearchKind, number> = {
  command: 0,
  tool: 1,
  book: 2,
  note: 3,
  password: 4,
  group: 5,
  conversation: 6
}

/** 一个可被搜索的对象 */
export interface SearchSource {
  kind: SearchKind
  id: string
  /** 主标题 */
  title: string
  /** 副标题：作者、网址、更新时间… */
  subtitle?: string
  /** 额外可匹配文本（笔记正文等），只用于匹配，不直接展示 */
  keywords?: string
}

/** 命中的位置，用于提示「在正文中命中」 */
export type SearchMatchField = 'title' | 'subtitle' | 'keywords'

/** 一条搜索结果 */
export type SearchHit<T extends SearchSource = SearchSource> = T & {
  score: number
  matched: SearchMatchField
}

/** 关键词最多比对这么多字符，避免超长正文拖慢输入 */
const MAX_KEYWORDS_CHARS = 4000

/**
 * 在候选集合里搜索。
 *
 * 泛型保留候选对象的额外字段（如「点了要干什么」的动作），
 * 这样调用方拿到的命中项可以直接执行。
 */
export function searchAll<T extends SearchSource>(
  query: string,
  sources: T[],
  limit = 24
): SearchHit<T>[] {
  const tokens = query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
  if (tokens.length === 0) return []

  const hits: SearchHit<T>[] = []
  for (const source of sources) {
    const title = source.title.toLowerCase()
    const subtitle = (source.subtitle ?? '').toLowerCase()
    const keywords = (source.keywords ?? '').slice(0, MAX_KEYWORDS_CHARS).toLowerCase()

    let score = 0
    let matched: SearchMatchField = 'title'
    let allMatched = true

    for (const token of tokens) {
      if (title.startsWith(token)) {
        score += 100
        matched = 'title'
      } else if (title.includes(token)) {
        score += 60
        matched = 'title'
      } else if (subtitle.includes(token)) {
        score += 30
        matched = 'subtitle'
      } else if (keywords.includes(token)) {
        score += 20
        matched = 'keywords'
      } else {
        allMatched = false
        break
      }
    }
    if (!allMatched) continue
    hits.push({ ...source, score, matched })
  }

  hits.sort(
    (a, b) =>
      b.score - a.score ||
      KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
      a.title.localeCompare(b.title, 'zh-Hans-CN')
  )
  return hits.slice(0, limit)
}
