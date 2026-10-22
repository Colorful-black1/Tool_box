import type { ToolGroup } from './registry'

export type ToolPlacement = 'before' | 'after'

/** 兼容旧配置与过期工具，外部顺序仅作为有界的 id 提示。 */
export function readToolOrder(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [
    ...new Set(
      value
        .slice(0, 100)
        .filter((id): id is string => typeof id === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(id))
    )
  ]
}

/** 保留分组归属；未保存的新工具按注册顺序追加，移除工具自动忽略。 */
export function orderToolGroups(groups: ToolGroup[], order: string[]): ToolGroup[] {
  return groups.map((group) => {
    const remaining = new Map(group.tools.map((tool) => [tool.id, tool]))
    const tools = readToolOrder(order).flatMap((id) => {
      const tool = remaining.get(id)
      if (!tool) return []
      remaining.delete(id)
      return [tool]
    })
    return { ...group, tools: [...tools, ...remaining.values()] }
  })
}

/** 按名称、描述及英文 id 匹配；多词同时命中，不执行用户表达式。 */
export function filterToolGroups(groups: ToolGroup[], query: string): ToolGroup[] {
  const normalize = (text: string): string => text.normalize('NFKC').toLowerCase()
  const words = normalize(query.slice(0, 100)).trim().split(/\s+/).filter(Boolean)
  if (!words.length) return groups
  return groups.flatMap((group) => {
    const tools = group.tools.filter((tool) => {
      const text = normalize(`${tool.id} ${tool.name} ${tool.description}`)
      return words.every((word) => text.includes(word))
    })
    return tools.length ? [{ ...group, tools }] : []
  })
}

/** 通过稳定 id 插入；无效或相同目标保持顺序，不修改输入数组。 */
export function moveTool(
  order: string[],
  sourceId: string,
  targetId: string,
  placement: ToolPlacement
): string[] {
  if (sourceId === targetId || !order.includes(sourceId) || !order.includes(targetId)) return order
  const next = order.filter((id) => id !== sourceId)
  const target = next.indexOf(targetId) + (placement === 'after' ? 1 : 0)
  next.splice(target, 0, sourceId)
  return next
}
