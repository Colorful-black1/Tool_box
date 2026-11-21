import type { FetchLike } from '../../github-trending/fetch'
import type { AiAgentArenaBoard, AiAgentArenaEntry } from '../../../../shared/ai-agent-arena'
import { AiAgentArenaError } from '../errors'
import { extractJsonArray, number, percent, text, uniqueBy } from '../normalize'
import { fetchSourceText } from './http'

export const TERMINAL_BENCH_URL = 'https://www.tbench.ai/'
const MAX_BYTES = 4 * 1024 * 1024

interface TerminalRow {
  id?: unknown
  rank?: unknown
  metadata?: {
    date?: unknown
    agent_display?: { label?: unknown }
    model_display?: { label?: unknown }
    reasoning_effort?: unknown
  }
  metrics?: Record<string, unknown>
}

/** 页面是 Next.js RSC，数据行在服务端渲染的 rows 数组里；不执行浏览器脚本。 */
export function parseTerminalBench(html: string): AiAgentArenaBoard {
  const payload: string[] = []
  const chunks = /self\.__next_f\.push\(\[1,("(?:\\.|[^"\\])*")\]\)/g
  for (const match of html.matchAll(chunks)) {
    try {
      payload.push(JSON.parse(match[1]) as string)
    } catch {
      // 单个 RSC 片段损坏时继续找其它片段，最终没有 rows 会明确报错。
    }
  }
  const textPayload = payload.join('')
  const rawRows = extractJsonArray(textPayload, '"rows":[')
  if (!rawRows) throw new AiAgentArenaError('Terminal-Bench 页面没有可解析的排行数据')
  let rows: TerminalRow[]
  try {
    rows = JSON.parse(rawRows) as TerminalRow[]
  } catch (error) {
    throw new AiAgentArenaError('Terminal-Bench 排行数据格式无法解析', { cause: error })
  }

  const entries: AiAgentArenaEntry[] = []
  for (const row of rows) {
    const metadata = row.metadata
    const metrics = row.metrics
    if (!metadata || !metrics) continue
    const agentName = text(metadata.agent_display?.label, 120)
    const modelName = text(metadata.model_display?.label, 160)
    if (!agentName || !modelName) continue
    const rank = number(row.rank)
    entries.push({
      id: `terminal-bench:${text(row.id, 80) || `${agentName}:${modelName}`}`,
      sourceRank: rank,
      agentId: agentName.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      agentName,
      agentVersion: null,
      modelName,
      modelVariant: text(metadata.reasoning_effort, 40) || null,
      values: {
        accuracy: number(metrics.accuracy),
        passAt3: percent(number(metrics.pass_at_3)),
        passAt5: percent(number(metrics.pass_at_5)),
        costUsd: number(metrics.total_cost_usd),
        tokens: number(metrics.total_tokens)
      },
      date: text(metadata.date, 20) || null,
      taskCount: null,
      attempts: number(metrics.n_trials),
      sourceUrl: TERMINAL_BENCH_URL
    })
  }

  const unique = uniqueBy(entries, (entry) => entry.id)
  if (!unique.length) throw new AiAgentArenaError('Terminal-Bench 页面没有可解析的排行记录')
  const pageVersion = /Terminal-Bench\s+(\d+(?:\.\d+)?)/i.exec(textPayload)?.[1] ?? '4.1'
  const capturedAt =
    unique
      .map((entry) => entry.date)
      .filter((value): value is string => Boolean(value))
      .sort()
      .at(-1) ?? null

  return {
    id: 'terminal-bench',
    name: `Terminal-Bench ${pageVersion}`,
    version: pageVersion,
    description: '终端任务评测：按官方 Resolution Rate 排名，展示 Pass@3 / Pass@5、成本和 Token。',
    capturedAt,
    taskCount: null,
    attemptsPerTask: null,
    primaryMetric: 'accuracy',
    columns: [
      { key: 'accuracy', label: 'Resolution Rate', unit: 'pct', direction: 'desc' },
      { key: 'passAt3', label: 'Pass@3', unit: 'pct', direction: 'desc' },
      { key: 'passAt5', label: 'Pass@5', unit: 'pct', direction: 'desc' },
      { key: 'costUsd', label: '成本', unit: 'usd', direction: 'asc' },
      { key: 'tokens', label: 'Token', unit: 'tokens', direction: 'asc' }
    ],
    entries: unique,
    sourceUrl: TERMINAL_BENCH_URL,
    notes: [
      '页面链接中的 ?version=2.1 没有锁定旧版本；当前页面实际显示 Terminal-Bench 4.1。',
      'Resolution Rate 为官方 accuracy；Pass@k 由官方 metrics 提供。',
      '同一模型在不同 Agent 下成绩可能不同，因此按 Agent × 模型组合展示。'
    ]
  }
}

export async function fetchTerminalBench(
  fetchImpl: FetchLike,
  cache: { etag: string | null; lastModified: string | null }
): Promise<{ notModified: boolean; board: AiAgentArenaBoard | null; etag: string | null; lastModified: string | null }> {
  const result = await fetchSourceText(fetchImpl, TERMINAL_BENCH_URL, {
    ...cache,
    maxBytes: MAX_BYTES,
    timeoutMs: 20_000
  })
  return {
    notModified: result.notModified,
    board: result.text ? parseTerminalBench(result.text) : null,
    etag: result.etag,
    lastModified: result.lastModified
  }
}
