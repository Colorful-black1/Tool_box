import { describe, expect, it } from 'vitest'

import { buildTodoDigest, startOfWeekMs } from './todo-digest'

const FRIDAY = new Date(2026, 9, 30, 15, 0, 0).getTime()

describe('startOfWeekMs', () => {
  it('回到本周一 00:00（周日归上一周）', () => {
    expect(new Date(startOfWeekMs(FRIDAY))).toEqual(new Date(2026, 9, 26, 0, 0, 0))
    expect(new Date(startOfWeekMs(new Date(2026, 10, 1, 23, 0, 0).getTime()))).toEqual(
      new Date(2026, 9, 26, 0, 0, 0)
    )
  })
})

describe('buildTodoDigest', () => {
  it('只收本周完成的条目，按完成时间排序', () => {
    const digest = buildTodoDigest(
      [
        { title: '补单测', completedAtMs: new Date(2026, 9, 30, 11, 0, 0).getTime() },
        { title: '上周的旧事', completedAtMs: new Date(2026, 9, 20, 11, 0, 0).getTime() },
        { title: '修 ABI', completedAtMs: new Date(2026, 9, 27, 9, 0, 0).getTime() },
        { title: '还没做完', completedAtMs: null }
      ],
      FRIDAY
    )
    expect(digest?.count).toBe(2)
    expect(digest?.title).toBe('周报 · 10/26–11/1 · 完成 2 条')
    expect(digest?.content).toBe(
      '本周完成 2 条。\n\n- 修 ABI（10/27）\n- 补单测（10/30）\n\n—— 待办清单 · 10/26 至 11/1'
    )
  })

  it('本周没有完成记录时返回 null', () => {
    expect(buildTodoDigest([], FRIDAY)).toBeNull()
    expect(
      buildTodoDigest(
        [{ title: '上周的旧事', completedAtMs: new Date(2026, 9, 20, 11, 0, 0).getTime() }],
        FRIDAY
      )
    ).toBeNull()
    expect(buildTodoDigest([{ title: '没做完', completedAtMs: null }], FRIDAY)).toBeNull()
  })

  it('超过 60 条时只列前 60 条并注明剩余数量', () => {
    const items = Array.from({ length: 70 }, (_, index) => ({
      title: `任务 ${index + 1}`,
      completedAtMs: new Date(2026, 9, 27, 0, index, 0).getTime()
    }))
    const digest = buildTodoDigest(items, FRIDAY)
    expect(digest?.count).toBe(70)
    expect(digest?.content.match(/^- 任务 /gm)).toHaveLength(60)
    expect(digest?.content).toContain('- 其余 10 条未列出')
  })

  it('标题为空时用「（无标题）」占位', () => {
    expect(
      buildTodoDigest(
        [{ title: '  ', completedAtMs: new Date(2026, 9, 28, 9, 0, 0).getTime() }],
        FRIDAY
      )?.content
    ).toContain('- （无标题）（10/28）')
  })
})
