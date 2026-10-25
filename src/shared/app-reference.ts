import { USAGE_CLIENTS } from './agent-usage'
import type { UsageQuery } from './agent-usage'
import { isDateKey } from './reading-stats'

/** 只用于用户主动打开应用内对象，不携带写入、路径执行或网络能力。 */
export type AppTarget =
  | { kind: 'note' | 'todo' | 'book' | 'group'; id: string }
  | { kind: 'chapter'; id: string; chapterIdx: number }
  | { kind: 'usage'; query: UsageQuery }

/** 由成功工具结果产生的有界标签和只读导航目标。 */
export interface AppReference {
  label: string
  target: AppTarget
}

const PREFIX = 'toolbox://open/'
const USAGE_KEYS = ['client', 'project', 'model', 'from', 'to'] as const

export function appTargetUrl(target: AppTarget): string {
  if (target.kind === 'usage') {
    const params = new URLSearchParams()
    for (const key of USAGE_KEYS) {
      const value = target.query[key]
      if (value) params.set(key, value)
    }
    return `${PREFIX}usage?${params}`
  }
  return `${PREFIX}${target.kind}/${encodeURIComponent(target.id)}${target.kind === 'chapter' ? `?chapter=${target.chapterIdx}` : ''}`
}

/** 模型生成的链接也视为不可信输入，只接受固定页面和筛选白名单。 */
export function parseAppTarget(href: string): AppTarget | null {
  if (!href.startsWith(PREFIX) || href.length > 13000) return null
  try {
    const url = new URL(href)
    if (url.hostname !== 'open' || url.username || url.password || url.port || url.hash) return null
    const parts = url.pathname.slice(1).split('/')
    const kind = parts[0]
    if (kind === 'usage' && parts.length === 1) {
      const query: UsageQuery = {}
      for (const [key, value] of url.searchParams) {
        if (!USAGE_KEYS.some((item) => item === key) || url.searchParams.getAll(key).length > 1)
          return null
        if (!value || value.length > 4096) return null
        if (key === 'client') {
          if (!Object.hasOwn(USAGE_CLIENTS, value)) return null
          query.client = value as keyof typeof USAGE_CLIENTS
        } else if (key === 'from' || key === 'to') {
          if (
            !isDateKey(value) ||
            !Number.isFinite(Date.parse(value)) ||
            new Date(value).toISOString().slice(0, 10) !== value
          )
            return null
          query[key] = value
        } else if (key === 'project' || key === 'model') query[key] = value
      }
      if (query.from && query.to && query.from > query.to) return null
      return { kind: 'usage', query }
    }
    if (parts.length !== 2 || !/^[a-zA-Z0-9_-]{1,64}$/.test(parts[1])) return null
    const id = parts[1]
    if (kind === 'chapter') {
      const value = url.searchParams.get('chapter') ?? ''
      if (url.searchParams.size !== 1 || !/^\d{1,8}$/.test(value)) return null
      return { kind, id, chapterIdx: Number(value) }
    }
    if (url.search) return null
    if (kind === 'note' || kind === 'todo' || kind === 'book' || kind === 'group')
      return { kind, id }
    return null
  } catch {
    // 不合法的文本仍可显示，绝不交给系统打开。
    return null
  }
}

/** 标签移除 Markdown 结构字符，引用总量由运行器限制。 */
export function referenceMarkdown(reference: AppReference): string {
  const label = reference.label.replace(/[[\]\\\r\n`*_<>]/g, '').slice(0, 120)
  return `[打开${label}](${appTargetUrl(reference.target)})`
}
