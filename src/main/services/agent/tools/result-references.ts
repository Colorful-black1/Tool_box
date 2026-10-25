import type { AppReference, AppTarget } from '../../../../shared/app-reference'

/** 既有只读／保存工具的对象入口；删除结果不生成已经失效的入口。 */
export function resultReferences(name: string, result: unknown): AppReference[] {
  const object = (value: unknown): Record<string, unknown> =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {}
  const data = object(result)
  const kind = name.startsWith('notes_')
    ? 'note'
    : name.startsWith('books_')
      ? 'book'
      : name.startsWith('groups_')
        ? 'group'
        : null
  if (!kind || name.endsWith('_delete')) return []
  const items = Array.isArray(result) ? result : [result]
  const refs: AppReference[] = []
  for (const item of items.slice(0, 20)) {
    const row = object(item)
    if (typeof row.id === 'string')
      refs.push({ label: String(row.title ?? row.name ?? '结果'), target: { kind, id: row.id } })
  }
  const book = object(data.book)
  if (kind === 'book' && typeof book.id === 'string') {
    const target: AppTarget =
      typeof data.chapterIdx === 'number'
        ? { kind: 'chapter', id: book.id, chapterIdx: data.chapterIdx }
        : { kind: 'book', id: book.id }
    refs.push({ label: String(data.title ?? book.title ?? '书籍'), target })
  }
  return refs
}
