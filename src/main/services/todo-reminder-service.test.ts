import { afterEach, describe, expect, it, vi } from 'vitest'
import { TodoReminderService } from './todo-reminder-service'
import type { TodoNotification } from './todo-reminder-service'

afterEach(() => {
  vi.useRealTimers()
})

function fixture() {
  let input: TodoNotification | undefined
  const reminder = { id: 'a', title: '事项', kind: 'due' as const, atMs: 1, startAtMs: null }
  const store = { pendingTodoReminders: vi.fn(() => [reminder]), markTodoReminders: vi.fn() }
  const open = vi.fn()
  const show = vi.fn((value: TodoNotification) => {
    input = value
    return vi.fn()
  })
  const service = new TodoReminderService({
    store,
    supported: () => true,
    show,
    changed: vi.fn(),
    open
  })
  return { service, store, open, show, input: () => input! }
}

describe('主进程待办通知', () => {
  it('系统支持不代表已显示；超时保留未提醒记录', async () => {
    vi.useFakeTimers()
    const f = fixture()
    f.service.check()
    await vi.advanceTimersByTimeAsync(10001)
    expect(f.store.markTodoReminders).not.toHaveBeenCalled()
    expect(f.service.status()).toMatch('未能')
    f.service.stop()
  })
  it('等待系统 show 才标记，点击触发定位', async () => {
    vi.useFakeTimers()
    const f = fixture()
    f.service.check()
    expect(f.store.markTodoReminders).not.toHaveBeenCalled()
    f.input().shown()
    await vi.advanceTimersByTimeAsync(0)
    expect(f.store.markTodoReminders).toHaveBeenCalledOnce()
    f.input().clicked()
    expect(f.open).toHaveBeenCalledWith('a')
    f.service.stop()
  })
  it('失败不标记，检查限速；停止后不再提醒', async () => {
    vi.useFakeTimers()
    const f = fixture()
    f.service.check()
    f.input().failed()
    await vi.advanceTimersByTimeAsync(0)
    expect(f.store.markTodoReminders).not.toHaveBeenCalled()
    expect(f.service.status()).toMatch('未能')
    f.service.check()
    expect(f.show).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(60001)
    f.service.check()
    expect(f.show).toHaveBeenCalledTimes(2)
    f.service.stop()
    await vi.advanceTimersByTimeAsync(120000)
    f.service.check()
    expect(f.show).toHaveBeenCalledTimes(2)
  })
  it('并发检查只显示一份，多个过期事项合并', async () => {
    vi.useFakeTimers()
    const f = fixture()
    const reminder = f.store.pendingTodoReminders()[0]
    f.store.pendingTodoReminders.mockReturnValue([reminder, { ...reminder, id: 'b' }])
    f.service.check()
    f.service.check()
    expect(f.show).toHaveBeenCalledOnce()
    expect(f.input().title).toMatch('2 项')
    f.input().shown()
    await vi.advanceTimersByTimeAsync(0)
    f.service.stop()
  })
})
