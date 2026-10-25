import { describe, expect, it, vi } from 'vitest'
import type { AgentDeps } from './deps'
import type { AgentToolContext } from '../tool-registry'
import type { UsageQuery } from '../../../../shared/agent-usage'
import { usageReport } from '../../agent-usage/report'
import { normalizeTokens, usageRecord } from '../../agent-usage/normalize'
import { usageRange, previousRange, usageTools } from './usage'

const ctx: AgentToolContext = {
  conversationId: 'c1',
  notifyToolCall: () => undefined,
  notifyToolResult: () => undefined,
  requestApproval: async () => true
}
describe('对话用量查询', () => {
  it('周、近七日、闰年和跨月的相邻区间按自然日计算', () => {
    const now = new Date(2024, 2, 1, 12)
    expect(usageRange('week', now)).toEqual({ from: '2024-02-26', to: '2024-03-01' })
    expect(usageRange('last7', now)).toEqual({ from: '2024-02-24', to: '2024-03-01' })
    expect(usageRange('lastWeek', now)).toEqual({ from: '2024-02-19', to: '2024-02-25' })
    expect(previousRange({ from: '2024-03-01', to: '2024-03-02' })).toEqual({
      from: '2024-02-28',
      to: '2024-02-29'
    })
  })
  it('与底层统计复用筛选口径，结果没有费用、路径或会话正文', async () => {
    const tokens = normalizeTokens(
      { input: 10, output: 5, cacheRead: 0, cacheWrite: 0 },
      'separate'
    )
    const records = [
      usageRecord('codex', 's1', 'r1', tokens, {
        project: '项目甲',
        model: '模型甲',
        time: new Date(2026, 9, 25, 12).getTime(),
        cost: 12
      })
    ]
    const query = vi.fn(async (input: UsageQuery) => usageReport(records, [], 1, input))
    const tool = usageTools({ usage: { query } } as unknown as AgentDeps)[0]
    const result = await tool.handler(
      {
        period: 'custom',
        from: '2026-10-25',
        to: '2026-10-25',
        client: 'codex',
        project: '项目甲'
      },
      ctx
    )
    expect(result).toMatchObject({
      tokens: { total: 15 },
      sessions: 1,
      query: { client: 'codex', project: '项目甲' }
    })
    expect(JSON.stringify(result)).not.toMatch(/cost|usd|paths|sessionId/)
    expect(tool.references!({}, result)[0].target).toMatchObject({
      kind: 'usage',
      query: { from: '2026-10-25' }
    })
  })
  it('未知和零基期均不给虚构百分比，非法参数不扫描', async () => {
    const query = vi.fn(async () => usageReport([], [], 1, {}))
    const tool = usageTools({ usage: { query } } as unknown as AgentDeps)[0]
    expect(await tool.handler({ period: 'today', comparePrevious: true }, ctx)).toMatchObject({
      comparison: { percent: null, reason: '总量未知' }
    })
    query.mockResolvedValue({
      ...usageReport([], [], 1, {}),
      tokens: normalizeTokens({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, 'separate')
    })
    expect(await tool.handler({ period: 'today', comparePrevious: true }, ctx)).toMatchObject({
      comparison: { percent: null, reason: '基期为零' }
    })
    query.mockClear()
    for (const input of [
      { client: '__proto__' },
      { period: 'custom', from: '2025-02-30', to: '2025-03-01' },
      { period: 'all', comparePrevious: true }
    ])
      await expect(tool.handler(input, ctx)).rejects.toThrow()
    expect(query).not.toHaveBeenCalled()
  })
})
