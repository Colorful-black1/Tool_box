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
  }
]
