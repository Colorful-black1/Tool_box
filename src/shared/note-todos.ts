/** 记事本里的未完成清单项（`- [ ] …`）转成待办标题，供编辑页一键写入待办清单。 */

/** 只认未完成项：`- [x]` 视为已办，普通列表项不是待办。 */
const TASK_LINE = /^[-*+]\s+\[ \]\s+(.+)$/
/** 待办标题上限与 `validateTodoInput` 保持一致。 */
const MAX_TITLE = 120
/** 单次最多写入的条数，避免误把整篇长清单一次性灌进待办。 */
const MAX_ITEMS = 50

export interface NoteTodoPlan {
  /** 待创建的标题，按笔记中的出现顺序。 */
  items: string[]
  /** 已有同名待办而跳过的条数。 */
  skipped: number
  /** 超出单次上限、本次未处理的条数。 */
  overflow: number
}

function normalize(text: string): string {
  return text.trim().toLowerCase()
}

export function planNoteTodos(
  content: string,
  existingTitles: readonly string[] = []
): NoteTodoPlan {
  const existing = new Set(existingTitles.map(normalize))
  const seen = new Set<string>()
  const items: string[] = []
  let skipped = 0
  let overflow = 0
  for (const raw of content.split(/\r?\n/)) {
    const match = raw.trim().match(TASK_LINE)
    if (!match) continue
    const text = match[1].replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE).trim()
    if (!text) continue
    const key = normalize(text)
    // 同一条笔记里重复出现的清单项只建一条待办。
    if (seen.has(key)) continue
    seen.add(key)
    if (existing.has(key)) {
      skipped += 1
      continue
    }
    if (items.length >= MAX_ITEMS) {
      overflow += 1
      continue
    }
    items.push(text)
  }
  return { items, skipped, overflow }
}
