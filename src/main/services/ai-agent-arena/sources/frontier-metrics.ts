import { mean, sum } from '../normalize'

/** 与 FrontierHarness 公开前端 Live.summary / rankPerPass 对齐的纯计算。 */

export interface FrontierHarness {
  id: string
  label: string
  version: string | null
}

export interface FrontierModel {
  id: string
  label: string
  effort: string | null
}

export interface FrontierAttempt {
  taskId: string
  harnessId: string
  modelId: string
  outcome: 'pass' | 'fail' | 'timeout' | 'infra'
  costUsd: number | null
  seconds: number | null
  tokens: number | null
  /** 在线答案查找等 reward-hacking 标记；通过也按失败计。 */
  lookup: boolean
}

export interface FrontierAggregate {
  harness: FrontierHarness
  model: FrontierModel
  passRate: number | null
  costPerTask: number | null
  costPerPass: number | null
  timePerTask: number | null
  timePerPass: number | null
  passAtK: number | null
  passHatK: number | null
  tokens: number | null
  attempts: number
  pricedAttempts: number
  tasks: number
  rank: number | null
}

function comb(n: number, k: number): number {
  if (k < 0 || k > n) return 0
  let result = 1
  for (let i = 1; i <= k; i++) result = (result * (n - k + i)) / i
  return result
}

export function passAtK(n: number, c: number, k: number): number | null {
  if (n < k) return null
  return n - c < k ? 1 : 1 - comb(n - c, k) / comb(n, k)
}

export function passHatK(n: number, c: number, k: number): number | null {
  if (n < k) return null
  return comb(c, k) / comb(n, k)
}

interface TaskStats {
  attempts: number
  passes: number
  costs: number[]
  seconds: number[]
}

/** 只聚合已完成的 pass/fail/timeout；infra 与不完整任务不进入评分。 */
export function aggregateFrontier(
  attempts: readonly FrontierAttempt[],
  harnesses: readonly FrontierHarness[],
  models: readonly FrontierModel[],
  cap: number
): FrontierAggregate[] {
  const harnessById = new Map(harnesses.map((item) => [item.id, item]))
  const modelById = new Map(models.map((item) => [item.id, item]))
  const groups = new Map<string, Map<string, TaskStats>>()

  for (const attempt of attempts) {
    if (attempt.outcome === 'infra') continue
    if (!harnessById.has(attempt.harnessId) || !modelById.has(attempt.modelId)) continue
    const key = `${attempt.harnessId}|${attempt.modelId}`
    let tasks = groups.get(key)
    if (!tasks) {
      tasks = new Map()
      groups.set(key, tasks)
    }
    let task = tasks.get(attempt.taskId)
    if (!task) {
      task = { attempts: 0, passes: 0, costs: [], seconds: [] }
      tasks.set(attempt.taskId, task)
    }
    task.attempts++
    if (attempt.outcome === 'pass' && !attempt.lookup) task.passes++
    if (attempt.costUsd != null && Number.isFinite(attempt.costUsd)) task.costs.push(attempt.costUsd)
    if (attempt.seconds != null && Number.isFinite(attempt.seconds))
      task.seconds.push(attempt.seconds)
  }

  const k = Math.max(1, Math.min(cap, 10))
  const aggregates: FrontierAggregate[] = []
  const byModel = new Map<string, FrontierAggregate[]>()
  for (const [key, tasks] of groups) {
    const [harnessId, modelId] = key.split('|')
    const harness = harnessById.get(harnessId)
    const model = modelById.get(modelId)
    if (!harness || !model) continue
    const values = [...tasks.values()]
    const attemptsCount = sum(values.map((task) => task.attempts))
    const passes = sum(values.map((task) => task.passes))
    const passRate = attemptsCount ? passes / attemptsCount : null
    const costPerTask = mean(values.map((task) => mean(task.costs)))
    const timePerTask = mean(values.map((task) => mean(task.seconds)))
    const passAt = mean(values.map((task) => passAtK(task.attempts, task.passes, k)))
    const passHat = mean(values.map((task) => passHatK(task.attempts, task.passes, k)))
    const tokens = sum(
      attempts
        .filter((attempt) => attempt.harnessId === harnessId && attempt.modelId === modelId)
        .map((attempt) => attempt.tokens ?? 0)
    )
    const aggregate: FrontierAggregate = {
      harness,
      model,
      passRate,
      costPerTask,
      costPerPass:
        costPerTask != null && passRate != null && passRate > 0 ? costPerTask / passRate : null,
      timePerTask,
      timePerPass:
        timePerTask != null && passRate != null && passRate > 0 ? timePerTask / passRate : null,
      passAtK: passAt,
      passHatK: passHat,
      tokens,
      attempts: attemptsCount,
      pricedAttempts: sum(values.map((task) => task.costs.length)),
      tasks: values.length,
      rank: null
    }
    aggregates.push(aggregate)
    const list = byModel.get(model.id)
    if (list) list.push(aggregate)
    else byModel.set(model.id, [aggregate])
  }

  // 官方 leaderboardOf 先按模型分组生成榜单；同一模型内再按 Cost per pass 排名。
  for (const list of byModel.values()) assignRanks(list)
  return aggregates
}

/** 官方效率榜：Cost per pass 升序；相同则 Pass rate 高者优先；同值共享名次。 */
export function assignRanks(items: FrontierAggregate[]): void {
  const score = (item: FrontierAggregate): number =>
    item.costPerPass == null || !(item.passRate && item.passRate > 0)
      ? Number.POSITIVE_INFINITY
      : item.costPerPass
  const sorted = [...items].sort(
    (a, b) => score(a) - score(b) || (b.passRate ?? 0) - (a.passRate ?? 0)
  )
  for (let i = 0; i < sorted.length; i++) {
    const item = sorted[i]
    const previous = sorted[i - 1]
    const same =
      i > 0 &&
      score(item) === score(previous) &&
      (Number.isFinite(score(item)) || item.passRate === previous.passRate)
    item.rank = same ? previous.rank : i + 1
  }
}
