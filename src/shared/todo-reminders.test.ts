import { describe, expect, it } from 'vitest'
import { dueTodoReminder } from './todo-reminders'

describe('待办到时规则', () => {
  const item = {
    id: 'a',
    title: '事项',
    startAtMs: 100,
    dueAtMs: 200,
    startNotifiedForMs: null,
    dueNotifiedForMs: null
  }
  it('开始与截止各一次，重启过截止只补截止', () => {
    expect(dueTodoReminder(item, 99)).toBeNull()
    expect(dueTodoReminder(item, 100)?.kind).toBe('start')
    expect(dueTodoReminder({ ...item, startNotifiedForMs: 100 }, 150)).toBeNull()
    expect(dueTodoReminder(item, 200)?.kind).toBe('due')
    expect(dueTodoReminder({ ...item, dueNotifiedForMs: 200 }, 300)).toBeNull()
  })
  it('修改时刻重新安排；只有开始或截止也可提醒', () => {
    expect(dueTodoReminder({ ...item, startNotifiedForMs: 90 }, 150)?.kind).toBe('start')
    expect(dueTodoReminder({ ...item, dueAtMs: null }, 300)?.kind).toBe('start')
    expect(dueTodoReminder({ ...item, startAtMs: null }, 300)?.kind).toBe('due')
  })
})
