import { describe, expect, it } from 'vitest'
import { claudeContextUsage, codexContextUsage, contextUsage } from './agent-session-metrics'

describe('原生上下文快照', () => {
  it('拒绝异常计数，缺失或无效窗口不伪装成零用量', () => {
    for (const value of [-1, NaN, Infinity, '20', Number.MAX_SAFE_INTEGER + 1])
      expect(contextUsage(value, 100, 'acp')).toBeUndefined()
    expect(contextUsage(50, 0, 'acp')?.windowTokens).toBeNull()
    expect(contextUsage(150, 100, 'acp')?.usedTokens).toBe(150)
  })
  it('Codex 只取最近请求，累计总量不能作为窗口分子', () => {
    expect(
      codexContextUsage({
        last: { totalTokens: 40 },
        total: { totalTokens: 9000 },
        modelContextWindow: 100
      })
    ).toMatchObject({ usedTokens: 40, windowTokens: 100, source: 'codex' })
    expect(
      codexContextUsage({ total: { totalTokens: 9000 }, modelContextWindow: 100 })
    ).toBeUndefined()
  })
  it('Claude 控制摘要和消息快照都保留压缩窗口与近似口径', () => {
    expect(
      claudeContextUsage({ totalTokens: 60, rawMaxTokens: 100, model: 'native-model' })
    ).toMatchObject({
      usedTokens: 60,
      windowTokens: 100,
      approximate: true,
      windowKind: 'compaction'
    })
    expect(claudeContextUsage({ total_tokens: 30, raw_max_tokens: 100 })?.usedTokens).toBe(30)
  })
})
