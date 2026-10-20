import { intParam, optionalInt, optionalText, textParam } from '../tool-registry'
import { resolveStatsRange, todayKey } from '../../shared-bridge'
import type { StatsRange } from '../../shared-bridge'
import type { ToolFactory } from './deps'

export const statsTools: ToolFactory = ({ store }) => [
  {
    name: 'stats_summary',
    description: '查询阅读统计：今日与累计的阅读时长、字数，以及最近 7 天的明细。',
    parameters: { type: 'object', properties: {} },
    risk: 'read',
    summarize: () => '已获取阅读统计',
    handler: async () => {
      const summary = await store.statsSummary()
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
    parameters: {
      type: 'object',
      properties: {
        from: textParam('起始日期 YYYY-MM-DD', 10),
        to: textParam('结束日期 YYYY-MM-DD，留空表示今天', 10),
        days: intParam('最近 N 天（含今天），与 from / to 二选一', 1, 366)
      }
    },
    risk: 'read',
    summarize: (_input, result) => {
      const data = result as StatsRange
      return `${data.fromDate} ~ ${data.toDate} 共 ${Math.round(data.totalDurationMs / 60000)} 分钟`
    },
    handler: async (input) => {
      const range = resolveStatsRange(
        {
          from: optionalText(input, 'from', '起始日期', 10),
          to: optionalText(input, 'to', '结束日期', 10),
          days: optionalInt(input, 'days', '天数', 1, 366)
        },
        todayKey()
      )
      return store.statsRange(range.fromDate, range.toDate)
    }
  }
]
