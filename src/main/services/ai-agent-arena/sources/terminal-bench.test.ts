import { describe, expect, it } from 'vitest'
import { parseTerminalBench } from './terminal-bench'

const rows = {
  rows: [
    {
      id: 'row-1',
      rank: 1,
      metadata: {
        date: '2026-11-17',
        agent_display: { label: 'Codex' },
        model_display: { label: 'GPT-5.5' },
        reasoning_effort: 'max'
      },
      metrics: {
        accuracy: 62.12,
        n_trials: 330,
        pass_at_3: 0.6924,
        pass_at_5: 0.7273,
        total_cost_usd: 1987.33,
        total_tokens: 3316652076
      }
    }
  ]
}
const text = `Terminal-Bench 4.1 ${JSON.stringify(rows)}`
const html = `<script>self.__next_f.push([1,${JSON.stringify(text)}])</script>`

describe('Terminal-Bench 解析', () => {
  it('从 RSC payload 读取官方行和指标', () => {
    const board = parseTerminalBench(html)
    expect(board.version).toBe('4.1')
    expect(board.entries).toHaveLength(1)
    expect(board.entries[0]).toMatchObject({
      agentName: 'Codex',
      modelName: 'GPT-5.5',
      modelVariant: 'max',
      sourceRank: 1,
      date: '2026-11-17'
    })
    expect(board.entries[0].values.accuracy).toBe(62.12)
    expect(board.entries[0].values.passAt3).toBeCloseTo(69.24)
    expect(board.entries[0].values.passAt5).toBeCloseTo(72.73)
    expect(board.entries[0].values.costUsd).toBe(1987.33)
    expect(board.entries[0].values.tokens).toBe(3316652076)
    expect(board.primaryMetric).toBe('accuracy')
  })

  it('缺少 rows 或空 rows 时明确报错', () => {
    expect(() => parseTerminalBench('<html></html>')).toThrow('没有可解析')
    expect(() =>
      parseTerminalBench(`<script>self.__next_f.push([1,${JSON.stringify('{"rows":[]}')}])</script>`)
    ).toThrow('没有可解析')
  })
})
