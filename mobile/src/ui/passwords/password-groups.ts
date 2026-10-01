/**
 * 密码箱列表的筛选与分组（纯逻辑）。
 *
 * 抽成独立 `.ts` 的原因同 `bookshelf-sort.ts`：留在 `.tsx` 里就无法在
 * vitest 的 node 环境测（会连带解析 react-native）。
 *
 * 分组字母直接用数据层算好的 `first_letter`，不在前端重算拼音 ——
 * 两端口径必须一致，否则同一条目在两端会落在不同字母下。
 */
import type { PasswordEntryView } from '../../shared-bridge'

/** 搜索 + 收藏筛选 */
export function filterEntries(
  items: PasswordEntryView[],
  query: string,
  favoritesOnly: boolean
): PasswordEntryView[] {
  const keyword = query.trim().toLowerCase()
  return items.filter((item) => {
    if (favoritesOnly && !item.isFavorite) return false
    if (!keyword) return true
    return [item.title, item.account, item.url]
      .join(' ')
      .toLowerCase()
      .includes(keyword)
  })
}

export interface PasswordSection {
  title: string
  data: PasswordEntryView[]
}

/** 按首字母分段；空字母归到 `#`（数字、符号开头） */
export function groupByLetter(items: PasswordEntryView[]): PasswordSection[] {
  const buckets = new Map<string, PasswordEntryView[]>()
  for (const item of items) {
    const key = item.firstLetter || '#'
    const bucket = buckets.get(key)
    if (bucket) bucket.push(item)
    else buckets.set(key, [item])
  }
  return Array.from(buckets.entries())
    .map(([title, data]) => ({ title, data }))
    .sort((a, b) => a.title.localeCompare(b.title))
}

/** 与 `MobileStore.duplicateKeys()` 同口径的重复键 */
export function duplicateKey(title: string, account: string): string {
  return `${title} ${account.trim()}`
}
