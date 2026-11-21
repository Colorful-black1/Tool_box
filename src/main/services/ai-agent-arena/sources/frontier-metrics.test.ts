import { describe, expect, it } from 'vitest'
import { aggregateFrontier, assignRanks, passAtK, passHatK } from './frontier-metrics'
import type { FrontierAttempt, FrontierAggregate } from './frontier-metrics'
import { parseFrontierHarness } from './frontierharness'

const harnesses = [
  { id: 'h1', label: 'Harness One', version: '1.0' },
  { id: 'h2', label: 'Harness Two', version: '2.0' }
]
const models = [{ id: 'm1', label: 'Model One', effort: 'max' }]

function attempt(
  taskId: string,
  outcome: FrontierAttempt['outcome'],
  costUsd = 1,
  overrides: Partial<FrontierAttempt> = {}
): FrontierAttempt {
  return {
    taskId,
    harnessId: 'h1',
    modelId: 'm1',
    outcome,
    costUsd,
    seconds: 10,
    tokens: 100,
    lookup: false,
    ...overrides
  }
}

describe('FrontierHarness 官方指标', () => {
  it('按任务计算通过率、Cost per pass 与 Pass@k / Pass^k', () => {
    const attempts = [
      attempt('t1', 'pass'),
      attempt('t1', 'pass'),
      attempt('t1', 'fail'),
      attempt('t1', 'timeout'),
      attempt('t2', 'pass'),
      attempt('t2', 'fail'),
      attempt('t2', 'fail'),
      attempt('t2', 'fail')
    ]
    const [result] = aggregateFrontier(attempts, harnesses, models, 4)
    expect(result.passRate).toBeCloseTo(3 / 8)
    expect(result.costPerTask).toBeCloseTo(1)
    expect(result.costPerPass).toBeCloseTo(1 / (3 / 8))
    expect(result.timePerTask).toBeCloseTo(10)
    expect(result.timePerPass).toBeCloseTo(10 / (3 / 8))
    expect(result.passAtK).toBeCloseTo(1)
    expect(result.passHatK).toBe(0)
    expect(result.attempts).toBe(8)
    expect(result.tasks).toBe(2)
  })

  it('infra 排除，lookup 的通过按失败计', () => {
    const attempts = [
      attempt('t1', 'pass'),
      attempt('t1', 'pass', 1, { lookup: true }),
      attempt('t1', 'infra', 99),
      attempt('t1', 'fail')
    ]
    const [result] = aggregateFrontier(attempts, harnesses, models, 4)
    expect(result.attempts).toBe(3)
    expect(result.passRate).toBeCloseTo(1 / 3)
    expect(result.tokens).toBe(400)
  })

  it('Cost per pass 相同则共享名次，下一名按官方规则跳号', () => {
    const attempts = [
      ...['pass', 'pass', 'fail', 'fail'].map((outcome) =>
        attempt('t1', outcome as FrontierAttempt['outcome'], 1)
      ),
      ...['pass', 'pass', 'fail', 'fail'].map((outcome) =>
        attempt('t1', outcome as FrontierAttempt['outcome'], 1, { harnessId: 'h2' })
      )
    ]
    const results = aggregateFrontier(attempts, harnesses, models, 4)
    expect(results.map((item) => item.rank)).toEqual([1, 1])
    const extra: FrontierAggregate = {
      ...results[0],
      harness: { id: 'h3', label: 'Harness Three', version: null },
      costPerPass: 3
    }
    assignRanks([...results, extra])
    expect(extra.rank).toBe(3)
  })

  it('Pass@k 与 Pass^k 公式在 n < k 时返回 null', () => {
    expect(passAtK(2, 1, 4)).toBeNull()
    expect(passHatK(2, 1, 4)).toBeNull()
    expect(passAtK(4, 2, 4)).toBe(1)
    expect(passHatK(4, 2, 4)).toBe(0)
  })
})

describe('FrontierHarness feed 解析', () => {
  it('按官方 live feed 生成 Agent × 模型行', () => {
    const fields = [
      'task',
      'harness',
      'model',
      'outcome',
      'cost_usd',
      'run_seconds',
      'input_tokens',
      'output_tokens',
      'lookup'
    ]
    const rows = [
      [0, 0, 0, 0, 1, 10, 60, 40, 0],
      [0, 0, 0, 1, 1, 10, 60, 40, 0],
      [1, 0, 0, 0, 1, 10, 60, 40, 0],
      [1, 0, 0, 1, 1, 10, 60, 40, 0]
    ]
    const feed = {
      version: 'feed-v1',
      end_ms: Date.UTC(2026, 10, 18, 12),
      tasks: [{ name: 'task-one' }, { name: 'task-two' }],
      harnesses: [{ id: 'h1', label: 'Harness One', version: '1.0' }],
      models: [{ id: 'm1', label: 'Model One', effort: 'max' }],
      outcomes: ['pass', 'fail', 'timeout', 'infra'],
      attempts: 2,
      finished_fields: fields,
      finished: rows
    }
    const board = parseFrontierHarness(JSON.stringify(feed))
    expect(board.version).toBe('feed-v1')
    expect(board.taskCount).toBe(2)
    expect(board.entries).toHaveLength(1)
    expect(board.entries[0]).toMatchObject({
      agentName: 'Harness One',
      agentVersion: '1.0',
      modelName: 'Model One',
      modelVariant: 'max'
    })
    expect(board.entries[0].values.passRate).toBe(50)
    expect(board.entries[0].values.costPerPass).toBeCloseTo(2)
    expect(board.entries[0].values.passAtK).toBe(100)
    expect(board.entries[0].values.passHatK).toBe(0)
    expect(board.entries[0].values.tokens).toBe(400)
    expect(board.primaryMetric).toBe('costPerPass')
  })
})
