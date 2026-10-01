import { describe, expect, it } from 'vitest'

import type { BookSummary } from '../../shared-bridge'
import { SORT_OPTIONS, sortBooks } from './bookshelf-sort'

function book(input: {
  id: string
  title: string
  sortIndex: number
  createdAtMs: number
  readAtMs?: number
}): BookSummary {
  return {
    id: input.id,
    title: input.title,
    author: '',
    chapterCount: 1,
    coverPath: '',
    sortIndex: input.sortIndex,
    groupId: null,
    createdAtMs: input.createdAtMs,
    updatedAtMs: input.createdAtMs,
    progress:
      input.readAtMs === undefined
        ? null
        : { chapterIdx: 0, percent: 0.5, updatedAtMs: input.readAtMs }
  }
}

const A = book({ id: 'a', title: '三体', sortIndex: 2, createdAtMs: 100, readAtMs: 30 })
const B = book({ id: 'b', title: '活着', sortIndex: 0, createdAtMs: 300 })
const C = book({ id: 'c', title: '百年孤独', sortIndex: 1, createdAtMs: 200, readAtMs: 10 })

/** 三本都没读过的副本，用来验证 recentRead 的「沉底后按手动序」分支 */
const UNREAD = [
  book({ id: 'a', title: '三体', sortIndex: 2, createdAtMs: 100 }),
  book({ id: 'b', title: '活着', sortIndex: 0, createdAtMs: 300 }),
  book({ id: 'c', title: '百年孤独', sortIndex: 1, createdAtMs: 200 })
]

const ids = (list: BookSummary[]): string[] => list.map((item) => item.id)

describe('sortBooks', () => {
  it('manual 按 sortIndex 升序', () => {
    expect(ids(sortBooks([A, B, C], 'manual'))).toEqual(['b', 'c', 'a'])
  })

  it('recentRead 把读过的按时间倒序在前，没读过的沉底', () => {
    expect(ids(sortBooks([B, A, C], 'recentRead'))).toEqual(['a', 'c', 'b'])
  })

  it('recentRead 下都没读过的退回手动序，顺序稳定不闪', () => {
    expect(ids(sortBooks(UNREAD, 'recentRead'))).toEqual(['b', 'c', 'a'])
  })

  it('addedTime 按加入时间倒序', () => {
    expect(ids(sortBooks([A, B, C], 'addedTime'))).toEqual(['b', 'c', 'a'])
  })

  // zh-Hans-CN 排序按拼音：百年孤独(bǎi) < 活着(huó) < 三体(sān)
  it('title 按中文拼音排序', () => {
    expect(ids(sortBooks([C, A, B], 'title'))).toEqual(['c', 'b', 'a'])
  })

  it('未知模式退回最近在读', () => {
    const mode = 'nope' as never
    expect(ids(sortBooks([B, A, C], mode))).toEqual(['a', 'c', 'b'])
  })

  it('不修改入参数组', () => {
    const input = [A, B, C]
    const before = ids(input)
    sortBooks(input, 'title')
    expect(ids(input)).toEqual(before)
  })

  it('空数组安全', () => {
    expect(sortBooks([], 'manual')).toEqual([])
  })
})

describe('SORT_OPTIONS', () => {
  it('四项且值唯一', () => {
    expect(SORT_OPTIONS.map((item) => item.value)).toEqual([
      'manual',
      'recentRead',
      'addedTime',
      'title'
    ])
    expect(new Set(SORT_OPTIONS.map((item) => item.value)).size).toBe(SORT_OPTIONS.length)
  })
})
