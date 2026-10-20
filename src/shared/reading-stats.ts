/**
 * 阅读统计的纯逻辑（两端共用）。
 *
 * 背景：统计表 `reading_stats(date, duration_ms, char_count)` 按天存，
 * 既有接口只有「今日 / 累计 / 最近 7 天」，回答不了「上个月读了多久」。
 * 两端各加一个 `statsRange` 查询方法，**日期解析与汇总**放这里共用，
 * 避免两边对「最近 N 天」「区间合计」的算法出现分叉。
 *
 * 日期键统一用本地时区的 `YYYY-MM-DD`（与两端 `addStatsToday` 写入的格式一致）。
 */
import type { ReadingStat, StatsRange } from './types'

/** 工具入参里的日期区间 */
export interface StatsRangeInput {
  /** 起始日期 YYYY-MM-DD */
  from?: string
  /** 结束日期 YYYY-MM-DD，留空表示今天 */
  to?: string
  /** 最近 N 天（含今天），与 from / to 二选一 */
  days?: number
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

/** 本地时区的今天，格式 YYYY-MM-DD */
export function todayKey(): string {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

/** 是否是合法的日期键（只校验形状，不校验「2 月 30 日」这类假日期） */
export function isDateKey(value: string): boolean {
  return DATE_PATTERN.test(value)
}

/**
 * 把工具入参解析成具体的日期区间。
 *
 * 支持两种写法：
 * - `days: 7` → 最近 7 天（含今天）
 * - `from` / `to` → 绝对日期，`to` 留空表示今天
 */
export function resolveStatsRange(
  input: StatsRangeInput,
  today: string
): { fromDate: string; toDate: string } {
  if (input.days !== undefined) {
    const days = Math.floor(input.days)
    if (!Number.isFinite(days) || days < 1 || days > 366) {
      throw new Error('天数需在 1 ~ 366 之间')
    }
    return { fromDate: shiftDate(today, -(days - 1)), toDate: today }
  }

  const from = (input.from ?? '').trim()
  const to = (input.to ?? '').trim() || today
  if (!isDateKey(from)) throw new Error('起始日期格式应为 YYYY-MM-DD')
  if (!isDateKey(to)) throw new Error('结束日期格式应为 YYYY-MM-DD')
  if (from > to) throw new Error('起始日期不能晚于结束日期')
  return { fromDate: from, toDate: to }
}

/** 把日期键平移 n 天（n 为负表示往前） */
export function shiftDate(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  date.setDate(date.getDate() + days)
  const monthText = String(date.getMonth() + 1).padStart(2, '0')
  const dayText = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${monthText}-${dayText}`
}

/** 把逐日明细汇总成区间统计 */
export function buildStatsRange(
  rows: ReadingStat[],
  fromDate: string,
  toDate: string
): StatsRange {
  let totalDurationMs = 0
  let totalCharCount = 0
  for (const row of rows) {
    totalDurationMs += row.durationMs
    totalCharCount += row.charCount
  }
  return {
    fromDate,
    toDate,
    totalDurationMs,
    totalCharCount,
    activeDays: rows.length,
    daily: rows
  }
}
