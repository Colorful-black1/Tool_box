import { describe, expect, it } from 'vitest'
import { usageReport, localDate } from './report'
import { normalizeTokens, usageRecord } from './normalize'

const tokens = normalizeTokens({ input: 10, output: 5, cacheRead: 0, cacheWrite: 0 }, 'separate')
describe('统一去重与筛选', () => {
  it('原生累计仅补缺失明细的差值，重复快照不增加，补差不伪造日期或模型', () => {
    const row = usageRecord('codex', 's', 'request', tokens, {
      time: new Date(2026, 9, 24).getTime(),
      model: 'fixture'
    })
    const snapshot = {
      ...usageRecord(
        'codex',
        's',
        'native-cumulative',
        { ...tokens, input: 30, output: 15, total: 45 },
        { requests: null }
      ),
      snapshot: true
    }
    expect(usageReport([row, snapshot, snapshot], [], 1, {}).tokens.total).toBe(45)
    expect(usageReport([row, snapshot], [], 1, { from: '2026-10-24' }).tokens.total).toBe(15)
    expect(usageReport([row, snapshot], [], 1, { model: 'fixture' }).tokens.total).toBe(15)
    expect(usageReport([row, snapshot], [], 1, {}).partial).toBe(true)
  })
  it('重复来源副本和 Claude 分叉中同一消息不重复计数', () => {
    const a = usageRecord('claude', 'a', 'global-message', tokens)
    const b = { ...a, sessionId: 'b' }
    const r = usageReport([a, a, b], [], 1, {})
    expect(r.tokens.total).toBe(15)
    expect(r.sessions).toBe(1)
  })
  it('旧副本不覆盖最终用量；不同文件累计快照选最大值', () => {
    const row = usageRecord('claude', 's', 'message', tokens, { time: 100 })
    const old = { ...row, tokens: { ...tokens, total: 10 } }
    expect(usageReport([row, old], [], 1, {}).tokens.total).toBe(15)
    const snapshot = {
      ...usageRecord(
        'codex',
        's',
        'native-cumulative',
        { ...tokens, total: 50 },
        { requests: null }
      ),
      snapshot: true
    }
    const smaller = { ...snapshot, tokens: { ...tokens, total: 20 } }
    expect(usageReport([snapshot, smaller], [], 1, {}).tokens.total).toBe(50)
  })
  it('时间未知仅纳入累计，不归入最近更新时间', () => {
    const a = usageRecord('codex', 's', '1', tokens)
    const b = usageRecord('codex', 's', '2', tokens, {
      time: new Date(2026, 9, 24, 23, 59).getTime()
    })
    expect(usageReport([a, b], [], 1, { from: '2026-10-24', to: '2026-10-24' }).tokens.total).toBe(
      15
    )
    const all = usageReport([a, b], [], 1, {})
    expect(all.tokens.total).toBe(30)
    expect(all.daily).toHaveLength(1)
    expect(all.unknownTime).toBe(1)
  })
  it('本地日历边界和 Agent / 项目 / 模型过滤一致作用于所有汇总', () => {
    const a = usageRecord('pi', 's', '1', tokens, {
      project: '/a',
      model: 'x',
      time: new Date(2026, 9, 24).getTime()
    })
    const b = usageRecord('pi', 's', '2', tokens, {
      project: '/a',
      model: 'y',
      time: new Date(2026, 9, 25).getTime()
    })
    expect(localDate(a.time!)).toBe('2026-10-24')
    const r = usageReport([a, b], [], 1, {
      client: 'pi',
      project: '/a',
      model: 'x',
      to: '2026-10-24'
    })
    expect(r.rows).toHaveLength(1)
    expect(r.daily[0].total).toBe(r.tokens.total)
  })
  it('分页不截断汇总；缺失数值不能显示为零', () => {
    const rows = Array.from({ length: 60 }, (_, i) => usageRecord('codex', String(i), '1', tokens))
    const r = usageReport(rows, [], 1, { offset: 50 })
    expect(r.rows).toHaveLength(10)
    expect(r.tokens.total).toBe(900)
    expect(usageReport([], [], 1, {}).tokens.total).toBeNull()
  })
  it('花费只累加原生上报，覆盖度单独返回', () => {
    const a = usageRecord('opencode', 's', '1', tokens, { cost: 0.2, time: 100 })
    const b = usageRecord('opencode', 's', '2', tokens, { time: 100 })
    const r = usageReport([a, b], [], 1, {})
    expect(r.cost).toEqual({ usd: 0.2, reported: 1, total: 2 })
    expect(r.rows).toHaveLength(1)
    expect(r.rows[0].costUsd).toBe(0.2)
    expect(r.rows[0].costPartial).toBe(true)
  })
  it('趋势不受日期范围限制，排行与每日统计只取当前范围', () => {
    const a = usageRecord('pi', 's', '1', tokens, {
      model: 'x',
      project: '/a',
      time: new Date(2026, 9, 24).getTime()
    })
    const b = usageRecord('pi', 's', '2', tokens, {
      model: 'y',
      project: '/a',
      time: new Date(2026, 9, 25).getTime()
    })
    const r = usageReport([a, b], [], 1, { from: '2026-10-24', to: '2026-10-24' })
    expect(r.rows).toHaveLength(1)
    expect(r.trend.map((day) => day.date)).toEqual(['2026-10-24', '2026-10-25'])
    expect(r.daily.map((day) => day.date)).toEqual(['2026-10-24'])
    expect(r.byModel.map((item) => item.key)).toEqual(['x'])
  })
  it('明细按白名单排序，导出条数受上限约束且不改变总量', () => {
    const make = (id: string, total: number) => usageRecord('codex', id, '1', { ...tokens, total })
    const rows = [make('a', 2), make('b', 6), make('c', 4)]
    expect(
      usageReport(rows, [], 1, { sort: 'total', desc: true }).rows.map((r) => r.tokens.total)
    ).toEqual([6, 4, 2])
    const limited = usageReport(rows, [], 1, { limit: 2 })
    expect(limited.rows).toHaveLength(2)
    expect(limited.rowCount).toBe(3)
    expect(limited.tokens.total).toBe(12)
  })
})
