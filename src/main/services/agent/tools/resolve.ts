import type { BookGroup, BookSummary, NoteView, PasswordEntryView } from '../../../../shared/types'
import type { ToolboxStore } from '../../chat-store/chat-store'

/**
 * 名称解析：AI 通常只知道书名 / 标题，不知道内部 ID。
 * 统一支持「ID 精确命中 → 名称精确命中 → 名称包含且唯一」三级回退，
 * 命中多个时抛出带候选的提示，交给模型改用更精确的说法。
 */
function normalize(value: string): string {
  return value.trim().toLowerCase()
}

function pickUnique<T>(
  ref: string,
  items: T[],
  idOf: (item: T) => string,
  nameOf: (item: T) => string,
  label: string
): T {
  const target = normalize(ref)
  const trimmed = ref.trim()
  if (!target) throw new Error(`请提供${label}名称或 ID`)

  const byId = items.find((item) => idOf(item) === trimmed)
  if (byId) return byId

  const exact = items.filter((item) => normalize(nameOf(item)) === target)
  const pool = exact.length > 0 ? exact : items.filter((item) => normalize(nameOf(item)).includes(target))
  if (pool.length === 1) return pool[0]
  if (pool.length === 0) throw new Error(`未找到匹配「${ref}」的${label}`)

  const names = pool.slice(0, 5).map(nameOf).join('、')
  throw new Error(`「${ref}」匹配到多个${label}：${names}，请更精确地指定`)
}

export function resolveBook(store: ToolboxStore, ref: string): BookSummary {
  return pickUnique(ref, store.listBooks(), (book) => book.id, (book) => book.title, '书籍')
}

export function resolveGroup(store: ToolboxStore, ref: string): BookGroup {
  return pickUnique(ref, store.listGroups(), (group) => group.id, (group) => group.name, '分组')
}

export function resolveNote(store: ToolboxStore, ref: string): NoteView {
  const notes = store.listNotes()
  const trimmed = ref.trim()
  const byId = notes.find((note) => note.id === trimmed)
  if (byId) return byId

  const target = normalize(ref)
  if (!target) throw new Error('请提供笔记标题或 ID')
  // 标题允许为空，空标题不参与名称匹配
  const pool = notes.filter((note) => note.title && normalize(note.title).includes(target))
  if (pool.length === 1) return pool[0]
  if (pool.length === 0) throw new Error(`未找到匹配「${ref}」的笔记`)
  const titles = pool.slice(0, 5).map((note) => note.title).join('、')
  throw new Error(`「${ref}」匹配到多篇笔记：${titles}，请更精确地指定`)
}

export function resolvePassword(
  store: ToolboxStore,
  ref: string
): PasswordEntryView {
  return pickUnique(
    ref,
    store.listPasswords(),
    (entry) => entry.id,
    (entry) => entry.title,
    '密码条目'
  )
}
