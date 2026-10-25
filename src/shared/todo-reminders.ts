/** 提醒只携带标题与时间，不把备注送进系统通知。 */
export interface TodoReminder {
  id: string
  title: string
  kind: 'start' | 'due'
  atMs: number
  startAtMs: number | null
}

export interface TodoReminderCandidate {
  id: string
  title: string
  startAtMs: number | null
  dueAtMs: number | null
  startNotifiedForMs: number | null
  dueNotifiedForMs: number | null
}

/** 截止已到时合并掉漏过的开始通知，避免重启弹出两次。 */
export function dueTodoReminder(item: TodoReminderCandidate, now: number): TodoReminder | null {
  if (item.dueAtMs !== null && item.dueAtMs <= now && item.dueNotifiedForMs !== item.dueAtMs)
    return {
      id: item.id,
      title: item.title,
      kind: 'due',
      atMs: item.dueAtMs,
      startAtMs: item.startAtMs
    }
  if (
    item.startAtMs !== null &&
    item.startAtMs <= now &&
    item.startNotifiedForMs !== item.startAtMs &&
    (item.dueAtMs === null || item.dueAtMs > now)
  )
    return {
      id: item.id,
      title: item.title,
      kind: 'start',
      atMs: item.startAtMs,
      startAtMs: item.startAtMs
    }
  return null
}
