import * as z from 'zod'

import { resolveStatsRange, todayKey } from '../../../../shared/reading-stats'
import type { StatsRange } from '../../../../shared/types'
import type { ToolFactory } from './deps'

export const statsTools: ToolFactory = ({ store }) => [
  {
    name: 'stats_summary',
    description: '查询阅读统计：今日与累计的阅读时长、字数，以及最近 7 天的明细。',
    schema: z.object({}),
    risk: 'read',
    summarize: () => '已获取阅读统计',
    handler: async () => {
      const summary = store.statsSummary()
      return {
        todayDurationMs: summary.todayDurationMs,
        totalDurationMs: summary.totalDurationMs,
        totalCharCount: summary.totalCharCount,
        recent: summary.recent
      }
    }
  },
  {
    name: 'stats_range',
    description:
      '查询指定日期区间的阅读统计。可以给 from / to（YYYY-MM-DD），也可以给 days 表示最近 N 天（含今天）。',
    schema: z.object({
      from: z.string().max(10).optional().describe('起始日期 YYYY-MM-DD'),
      to: z.string().max(10).optional().describe('结束日期 YYYY-MM-DD，留空表示今天'),
      days: z
        .number()
        .int()
        .min(1)
        .max(366)
        .optional()
        .describe('最近 N 天（含今天），与 from / to 二选一')
    }),
    risk: 'read',
    summarize: (_input, result) => {
      const data = result as StatsRange
      return `${data.fromDate} ~ ${data.toDate} 共 ${Math.round(data.totalDurationMs / 60000)} 分钟`
    },
    handler: async (input) => {
      const range = resolveStatsRange(
        {
          from: typeof input.from === 'string' ? input.from : undefined,
          to: typeof input.to === 'string' ? input.to : undefined,
          days: typeof input.days === 'number' ? input.days : undefined
        },
        todayKey()
      )
      return store.statsRange(range.fromDate, range.toDate)
    }
  }
]
