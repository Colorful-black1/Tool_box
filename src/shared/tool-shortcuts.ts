/** 工具快捷入口只存稳定 ID，不包含工具输入、输出或搜索记录。 */
export const MAX_TOOL_FAVORITES = 30
export const MAX_TOOL_RECENT = 5
export const VISIBLE_TOOL_RECENT = 5
const TOOL_ID = /^[a-z][a-z0-9-]{0,63}$/

/** 兼容旧版与损坏偏好；主进程写入时仍使用严格校验。 */
export function readToolIds(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) return []
  const ids = value.filter((id): id is string => typeof id === 'string' && TOOL_ID.test(id))
  return [...new Set(ids)].slice(0, limit)
}

export function validateToolIds(value: unknown, limit: number): string[] {
  if (!Array.isArray(value) || value.length > limit) throw new Error(`工具快捷入口最多 ${limit} 项`)
  const result: string[] = []
  for (const id of value) {
    if (typeof id !== 'string' || !TOOL_ID.test(id)) throw new Error('工具标识无效')
    if (result.includes(id)) throw new Error('工具快捷入口不能包含重复项')
    result.push(id)
  }
  return result
}

/** 去掉已移除工具；空输入快捷入口中收藏优先，再按最近顺序补齐并去重。 */
export function shortcutToolIds(known: string[], favorites: string[], recent: string[]): string[] {
  const valid = new Set(known)
  return [
    ...new Set([
      ...readToolIds(favorites, MAX_TOOL_FAVORITES),
      ...readToolIds(recent, recent.length)
        .filter((id) => valid.has(id))
        .slice(0, VISIBLE_TOOL_RECENT)
    ])
  ].filter((id) => valid.has(id))
}
