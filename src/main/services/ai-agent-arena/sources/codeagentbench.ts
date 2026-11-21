import type { FetchLike } from '../../github-trending/fetch'
import type { AiAgentArenaBoard, AiAgentArenaEntry } from '../../../../shared/ai-agent-arena'
import { AiAgentArenaError } from '../errors'
import { htmlAttribute, number, percent, text, uniqueBy } from '../normalize'
import { fetchSourceText } from './http'

export const CODEAGENTBENCH_URL = 'https://suyoumo.github.io/code-agent-bench/'
const MAX_BYTES = 4 * 1024 * 1024

/** 官方导出的数据字段；页面没有 JSON API，只解析固定表格属性。 */
export function parseCodeAgentBench(html: string): AiAgentArenaBoard {
  const rows = [...html.matchAll(/<tr\b[^>]*\bdata-agent="[^"]*"[\s\S]*?<\/tr>/gi)]
  const entries: AiAgentArenaEntry[] = []
  for (const [index, match] of rows.entries()) {
    const row = match[0]
    const agentId = text(htmlAttribute(row, 'data-agent'), 80)
    const agentName = text(htmlAttribute(row, 'data-agent-label'), 120)
    const modelName = text(htmlAttribute(row, 'data-model-name'), 160)
    const modelDir = text(htmlAttribute(row, 'data-model-dir'), 120)
    if (!agentId || !agentName || !modelName) continue
    const date = text(htmlAttribute(row, 'data-exported-at'), 40) || null
    const tokenValue = number(htmlAttribute(row, 'data-total-tokens'))
    entries.push({
      id: `codeagentbench:${agentId}:${modelDir || index}`,
      sourceRank: number(htmlAttribute(row, 'data-rank')),
      agentId,
      agentName,
      agentVersion: text(htmlAttribute(row, 'data-agent-version'), 80) || null,
      modelName,
      modelVariant: null,
      values: {
        finalScore: number(htmlAttribute(row, 'data-final-score')),
        passAt3: percent(number(htmlAttribute(row, 'data-pass-at-3-rate'))),
        passHat3: percent(number(htmlAttribute(row, 'data-pass-3-rate'))),
        attemptScore: percent(number(htmlAttribute(row, 'data-attempt-score'))),
        tokens: tokenValue && tokenValue > 0 ? tokenValue : null
      },
      date,
      taskCount: 151,
      attempts: 453,
      sourceUrl: CODEAGENTBENCH_URL
    })
  }

  const unique = uniqueBy(entries, (entry) => entry.id)
  if (!unique.length) throw new AiAgentArenaError('CodeAgentBench 页面没有可解析的排行记录')
  const capturedAt =
    unique
      .map((entry) => entry.date)
      .filter((value): value is string => Boolean(value))
      .sort()
      .at(-1) ?? null

  return {
    id: 'codeagentbench',
    name: 'CodeAgentBench',
    version: 'SWE-Bench-Pro',
    description: 'SWE-Bench-Pro：151 个任务、每个任务 3 次尝试；官方 Final Score 为主指标。',
    capturedAt,
    taskCount: 151,
    attemptsPerTask: 3,
    primaryMetric: 'finalScore',
    columns: [
      { key: 'finalScore', label: 'Final Score', unit: 'score', direction: 'desc' },
      { key: 'passAt3', label: 'Pass@3', unit: 'pct', direction: 'desc' },
      { key: 'passHat3', label: 'Pass^3', unit: 'pct', direction: 'desc' },
      { key: 'attemptScore', label: 'Attempt Score', unit: 'pct', direction: 'desc' },
      { key: 'tokens', label: 'Token', unit: 'tokens', direction: 'asc' }
    ],
    entries: unique,
    sourceUrl: CODEAGENTBENCH_URL,
    notes: [
      'Final Score = 100 × S^0.55 × R^0.25 × A^0.20；S、R、A 均来自官方 Pass^3 / Pass@3 / Attempt Score。',
      '榜单按导出批次更新；页面显示的导出日期可能早于当前日期。',
      '同一模型在不同 Agent 下成绩可能明显不同，因此按 Agent × 模型组合展示。'
    ]
  }
}

export async function fetchCodeAgentBench(
  fetchImpl: FetchLike,
  cache: { etag: string | null; lastModified: string | null }
): Promise<{ notModified: boolean; board: AiAgentArenaBoard | null; etag: string | null; lastModified: string | null }> {
  const result = await fetchSourceText(fetchImpl, CODEAGENTBENCH_URL, {
    ...cache,
    maxBytes: MAX_BYTES,
    timeoutMs: 20_000
  })
  return {
    notModified: result.notModified,
    board: result.text ? parseCodeAgentBench(result.text) : null,
    etag: result.etag,
    lastModified: result.lastModified
  }
}
