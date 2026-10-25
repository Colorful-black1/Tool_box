import * as z from 'zod'
import { USAGE_CLIENTS } from '../../../../shared/agent-usage'
import type { UsageQuery, UsageReport } from '../../../../shared/agent-usage'
import { isDateKey, shiftDate } from '../../../../shared/reading-stats'
import { validateUsageQuery } from '../../../ipc/validation'
import type { ToolFactory } from './deps'

const periods = [
  'today',
  'yesterday',
  'week',
  'lastWeek',
  'month',
  'last7',
  'last30',
  'custom',
  'all'
] as const
type Period = (typeof periods)[number]

/** 日历日期运算不按 24 小时毫秒平移，避免跨夏令时产生偏差。 */
export function usageRange(period: Period, now = new Date()): Pick<UsageQuery, 'from' | 'to'> {
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  const monday = shiftDate(today, -((now.getDay() + 6) % 7))
  switch (period) {
    case 'today':
      return { from: today, to: today }
    case 'yesterday':
      return { from: shiftDate(today, -1), to: shiftDate(today, -1) }
    case 'week':
      return { from: monday, to: today }
    case 'lastWeek':
      return { from: shiftDate(monday, -7), to: shiftDate(monday, -1) }
    case 'month':
      return { from: today.slice(0, 8) + '01', to: today }
    case 'last7':
      return { from: shiftDate(today, -6), to: today }
    case 'last30':
      return { from: shiftDate(today, -29), to: today }
    case 'custom':
    case 'all':
      return {}
  }
}

export function previousRange(query: UsageQuery): { from: string; to: string } {
  if (!query.from || !query.to || !isDateKey(query.from) || !isDateKey(query.to))
    throw new Error('环比需要明确的开始和结束日期')
  const days = Math.round((Date.parse(query.to) - Date.parse(query.from)) / 86400000) + 1
  if (days < 1 || days > 3660) throw new Error('环比区间需为 1 至 3660 个自然日')
  return { from: shiftDate(query.from, -days), to: shiftDate(query.from, -1) }
}

/** 只返回用量和覆盖度，不返回费用、原始记录、会话正文或认证内容。 */
function compact(report: UsageReport): object {
  const rank = (items: UsageReport['byProject']): object[] =>
    items.slice(0, 20).map((item) => ({
      name: item.key,
      tokens: item.tokens,
      requests: item.requests,
      sessions: item.sessions
    }))
  return {
    scannedAt: report.scannedAt,
    tokens: report.tokens,
    requests: report.requests,
    sessions: report.sessions,
    partial: report.partial,
    unknownTime: report.unknownTime,
    sources: report.sources.map(({ client, status, detail, records }) => ({
      client,
      status,
      detail,
      records
    })),
    byClient: report.byClient.map(({ client, tokens }) => ({
      client,
      name: USAGE_CLIENTS[client],
      tokens
    })),
    byProject: rank(report.byProject),
    byModel: rank(report.byModel),
    daily: report.daily.slice(-93),
    dailyTruncated: report.daily.length > 93,
    projects: report.projects.slice(0, 50),
    models: report.models.slice(0, 50),
    catalogTruncated: report.projects.length > 50 || report.models.length > 50
  }
}

export const usageTools: ToolFactory = ({ usage }) =>
  usage
    ? [
        {
          name: 'usage_query',
          description:
            '查询本机各 Agent Token 用量、项目／模型排行、每日趋势和来源状态，可作相邻等长自然日环比。week 为本周至今；默认近七日。未知不等于零，不估算费用。项目与模型按确切名称筛选。',
          schema: z.object({
            period: z.enum(periods).optional(),
            client: z
              .string()
              .max(30)
              .optional()
              .describe('来源 ID，如 codex、opencode、claude、kimi、pi、workbuddy、dsh、zcode'),
            project: z.string().max(4096).optional(),
            model: z.string().max(4096).optional(),
            from: z.string().max(10).optional().describe('custom 时必填，YYYY-MM-DD'),
            to: z.string().max(10).optional().describe('custom 时必填，包含结束日整日'),
            comparePrevious: z.boolean().optional(),
            refresh: z.boolean().optional().describe('仅用户要求重新扫描时开启')
          }),
          risk: 'read',
          handler: async (input, ctx) => {
            const period = z
              .enum(periods)
              .parse(input.period ?? (input.from || input.to ? 'custom' : 'last7'))
            if (period === 'custom' && (!input.from || !input.to))
              throw new Error('自定义区间需要开始和结束日期')
            if (period !== 'custom' && (input.from || input.to))
              throw new Error('指定日期时请使用 custom 周期')
            const query = validateUsageQuery({
              ...usageRange(period),
              ...(period === 'custom' ? { from: input.from, to: input.to } : {}),
              client: input.client,
              project: input.project,
              model: input.model,
              refresh: input.refresh,
              limit: 1
            })
            const previous = input.comparePrevious ? previousRange(query) : null
            const report = await usage.query(query)
            if (ctx.signal?.aborted) throw new Error('操作已停止')
            let comparison: object | null = null
            if (previous) {
              const before = await usage.query({ ...query, ...previous, refresh: false })
              const currentTotal = report.tokens.total
              const previousTotal = before.tokens.total
              const incomplete = [report, before].some(
                (value) =>
                  value.partial ||
                  value.sources.some(
                    (source) =>
                      (!query.client || source.client === query.client) &&
                      (source.status === 'partial' || source.status === 'error')
                  )
              )
              const reason = incomplete
                ? '数据覆盖不完整'
                : currentTotal === null || previousTotal === null
                  ? '总量未知'
                  : previousTotal === 0
                    ? '基期为零'
                    : null
              comparison = {
                range: previous,
                tokens: before.tokens,
                partial: before.partial,
                difference:
                  currentTotal !== null && previousTotal !== null
                    ? currentTotal - previousTotal
                    : null,
                percent:
                  reason === null && previousTotal !== null && currentTotal !== null
                    ? ((currentTotal - previousTotal) / previousTotal) * 100
                    : null,
                reason
              }
            }
            return { query, ...compact(report), comparison }
          },
          references: (_input, result) => [
            {
              label: 'Token 统计（本次筛选）',
              target: { kind: 'usage', query: (result as { query: UsageQuery }).query }
            }
          ]
        }
      ]
    : []
