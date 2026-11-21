import type { FetchLike } from '../../github-trending/fetch'
import type { AiAgentArenaBoard, AiAgentArenaEntry } from '../../../../shared/ai-agent-arena'
import { AiAgentArenaError } from '../errors'
import { number, text, uniqueBy } from '../normalize'
import { aggregateFrontier } from './frontier-metrics'
import type { FrontierAttempt, FrontierHarness, FrontierModel } from './frontier-metrics'
import { fetchSourceText } from './http'

export const FRONTIERHARNESS_URL = 'https://frontierharness.org/efficiency/'
const FRONTIER_LIVE_URL = 'https://frontierharness.org/api/live?since=0'
const MAX_BYTES = 12 * 1024 * 1024

interface FrontierFeed {
  version?: unknown
  end_ms?: unknown
  tasks?: Array<{ name?: unknown; subset?: unknown }>
  harnesses?: Array<{ id?: unknown; label?: unknown; version?: unknown }>
  models?: Array<{ id?: unknown; label?: unknown; effort?: unknown }>
  outcomes?: unknown[]
  attempts?: unknown
  finished_fields?: unknown[]
  finished?: unknown[][]
}

function fieldIndexes(fields: unknown): Map<string, number> {
  if (!Array.isArray(fields)) throw new AiAgentArenaError('FrontierHarness feed 缺少字段索引')
  const result = new Map<string, number>()
  fields.forEach((field, index) => {
    if (typeof field === 'string') result.set(field, index)
  })
  return result
}

function required(indexes: Map<string, number>, name: string): number {
  const value = indexes.get(name)
  if (value == null) throw new AiAgentArenaError(`FrontierHarness feed 缺少 ${name} 字段`)
  return value
}

/** 读取公开 live feed；评分口径与官方 efficiency 榜一致。 */
export function parseFrontierHarness(json: string): AiAgentArenaBoard {
  let feed: FrontierFeed
  try {
    feed = JSON.parse(json.replace(/^\uFEFF/, '')) as FrontierFeed
  } catch (error) {
    throw new AiAgentArenaError('FrontierHarness feed 不是有效 JSON', { cause: error })
  }
  if (!Array.isArray(feed.finished) || !Array.isArray(feed.harnesses) || !Array.isArray(feed.models))
    throw new AiAgentArenaError('FrontierHarness feed 缺少必要字段')
  const tasks = Array.isArray(feed.tasks) ? feed.tasks : []
  const taskNames = tasks.map((task, index) => text(task.name, 160) || `task-${index}`)
  const harnesses: FrontierHarness[] = feed.harnesses
    .map((harness, index) => ({
      id: text(harness.id, 80) || `harness-${index}`,
      label: text(harness.label, 120) || `Harness ${index + 1}`,
      version: text(harness.version, 80) || null
    }))
    .filter((harness) => harness.id)
  const models: FrontierModel[] = feed.models
    .map((model, index) => ({
      id: text(model.id, 80) || `model-${index}`,
      label: text(model.label, 160) || `Model ${index + 1}`,
      effort: text(model.effort, 40) || null
    }))
    .filter((model) => model.id)
  const fields = fieldIndexes(feed.finished_fields)
  const taskIndex = required(fields, 'task')
  const harnessIndex = required(fields, 'harness')
  const modelIndex = required(fields, 'model')
  const outcomeIndex = required(fields, 'outcome')
  const costIndex = required(fields, 'cost_usd')
  const secondsIndex = required(fields, 'run_seconds')
  const inputTokensIndex = required(fields, 'input_tokens')
  const outputTokensIndex = required(fields, 'output_tokens')
  const lookupIndex = fields.get('lookup')
  const outcomes = Array.isArray(feed.outcomes) ? feed.outcomes : ['pass', 'fail', 'timeout', 'infra']
  const attemptsCap = Math.max(1, Math.min(10, Math.round(number(feed.attempts) ?? 4)))

  const attempts: FrontierAttempt[] = []
  for (const row of feed.finished) {
    if (!Array.isArray(row)) continue
    const task = taskNames[Number(row[taskIndex])]
    const harness = harnesses[Number(row[harnessIndex])]
    const model = models[Number(row[modelIndex])]
    if (!task || !harness || !model) continue
    const rawOutcome = outcomes[Number(row[outcomeIndex])]
    const outcome =
      rawOutcome === 'pass' || rawOutcome === 'fail' || rawOutcome === 'timeout' || rawOutcome === 'infra'
        ? rawOutcome
        : 'fail'
    const inputTokens = number(row[inputTokensIndex]) ?? 0
    const outputTokens = number(row[outputTokensIndex]) ?? 0
    attempts.push({
      taskId: task,
      harnessId: harness.id,
      modelId: model.id,
      outcome,
      costUsd: number(row[costIndex]),
      seconds: number(row[secondsIndex]),
      tokens: inputTokens + outputTokens,
      lookup: lookupIndex == null ? false : Number(row[lookupIndex] ?? 0) > 0
    })
  }

  const aggregates = aggregateFrontier(attempts, harnesses, models, attemptsCap)
  const capturedAt =
    typeof feed.end_ms === 'number' && Number.isFinite(feed.end_ms)
      ? new Date(feed.end_ms).toISOString()
      : null
  const entries: AiAgentArenaEntry[] = aggregates
    .filter((item) => item.attempts > 0)
    .map((item) => ({
      id: `frontierharness:${item.harness.id}:${item.model.id}`,
      sourceRank: item.rank,
      agentId: item.harness.id,
      agentName: item.harness.label,
      agentVersion: item.harness.version,
      modelName: item.model.label,
      modelVariant: item.model.effort,
      values: {
        costPerPass: item.costPerPass,
        passRate: item.passRate == null ? null : item.passRate * 100,
        costPerTask: item.costPerTask,
        timePerPass: item.timePerPass,
        passAtK: item.passAtK == null ? null : item.passAtK * 100,
        passHatK: item.passHatK == null ? null : item.passHatK * 100,
        tokens: item.tokens
      },
      date: capturedAt?.slice(0, 10) ?? null,
      taskCount: item.tasks,
      attempts: item.attempts,
      sourceUrl: FRONTIERHARNESS_URL
    }))
  const unique = uniqueBy(entries, (entry) => entry.id)
  if (!unique.length) throw new AiAgentArenaError('FrontierHarness feed 没有可解析的排行记录')

  return {
    id: 'frontierharness',
    name: 'FrontierHarness',
    version: text(feed.version, 80) || null,
    description:
      '效率榜：同一模型在不同 harness 下分别运行；官方按 Cost per pass 排序，同时展示通过率与耗时。',
    capturedAt,
    taskCount: tasks.length || null,
    attemptsPerTask: attemptsCap,
    primaryMetric: 'costPerPass',
    columns: [
      { key: 'costPerPass', label: 'Cost per pass', unit: 'usd', direction: 'asc' },
      { key: 'passRate', label: 'Pass rate', unit: 'pct', direction: 'desc' },
      { key: 'costPerTask', label: '平均每任务成本', unit: 'usd', direction: 'asc' },
      { key: 'timePerPass', label: 'Time per pass', unit: 'seconds', direction: 'asc' },
      { key: 'passAtK', label: `Pass@${attemptsCap}`, unit: 'pct', direction: 'desc' },
      { key: 'passHatK', label: `Pass^${attemptsCap}`, unit: 'pct', direction: 'desc' },
      { key: 'tokens', label: 'Token', unit: 'tokens', direction: 'asc' }
    ],
    entries: unique,
    sourceUrl: FRONTIERHARNESS_URL,
    notes: [
      'Cost per pass = 平均每任务成本 / 通过率；按官方效率榜从低到高排名，相同成本时通过率高者优先。',
      '官方名次按同一模型内的 harness 比较；跨模型表格默认按 Cost per pass 排序，详情中显示同模型官方名次。',
      'infra 结果排除；reward-hacking 的 lookup 尝试按失败计。',
      '页面显示的是官方 live feed 聚合口径；同一模型在不同 harness 下成绩可能明显不同。'
    ]
  }
}

export async function fetchFrontierHarness(
  fetchImpl: FetchLike,
  cache: { etag: string | null; lastModified: string | null }
): Promise<{ notModified: boolean; board: AiAgentArenaBoard | null; etag: string | null; lastModified: string | null }> {
  const result = await fetchSourceText(fetchImpl, FRONTIER_LIVE_URL, {
    ...cache,
    maxBytes: MAX_BYTES,
    timeoutMs: 45_000,
    accept: 'application/json'
  })
  return {
    notModified: result.notModified,
    board: result.text ? parseFrontierHarness(result.text) : null,
    etag: result.etag,
    lastModified: result.lastModified
  }
}
