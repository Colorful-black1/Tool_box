import { describe, expect, it } from 'vitest'
import { validateTodoInput, validateTodoQuery } from './validation'

describe('待办边界校验', () => {
  const input = {
    title: '事项',
    details: '',
    priority: 'normal',
    startAtMs: null,
    dueAtMs: null,
    remind: true
  }
  it('可选日期允许 null，不接受伪造类型与非法时间', () => {
    expect(validateTodoInput(input).startAtMs).toBeNull()
    for (const patch of [
      { title: ' ' },
      { priority: 'urgent' },
      { remind: 'yes' },
      { startAtMs: NaN },
      { dueAtMs: -1 },
      { startAtMs: 2, dueAtMs: 1 },
      { details: 'x'.repeat(4001) }
    ])
      expect(() => validateTodoInput({ ...input, ...patch })).toThrow()
  })
  it('查询只接受白名单与有界分页', () => {
    const query = { filter: 'all', search: '', offset: 0, limit: 30 }
    expect(validateTodoQuery(query).limit).toBe(30)
    for (const patch of [
      { filter: 'DROP TABLE' },
      { offset: -1 },
      { limit: 101 },
      { limit: 0 },
      { focusId: 'x'.repeat(65) }
    ])
      expect(() => validateTodoQuery({ ...query, ...patch })).toThrow()
  })
})
