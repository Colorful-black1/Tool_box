/**
 * AI Agent 排行：ToolBox 原生采集快照的只读契约。
 *
 * 数据来自三个公开榜单，按 Agent × 模型组合展示：
 * - CodeAgentBench：SWE-Bench-Pro（Final Score）
 * - Terminal-Bench：终端任务（Resolution Rate）
 * - FrontierHarness：效率榜（Cost per pass）
 *
 * 不同榜单的任务与评分不同，不跨榜合并成单一分数。
 */

export type AiAgentArenaSourceId = 'codeagentbench' | 'terminal-bench' | 'frontierharness'

export type AiAgentArenaMetricUnit = 'score' | 'pct' | 'usd' | 'tokens' | 'seconds'

export type AiAgentArenaSortDirection = 'asc' | 'desc'

export interface AiAgentArenaColumn {
  key: string
  label: string
  unit: AiAgentArenaMetricUnit
  direction: AiAgentArenaSortDirection
}

/** 一条 Agent × 模型记录；values 的键由所属榜单的 columns 定义。 */
export interface AiAgentArenaEntry {
  id: string
  /** 来源榜单的原始名次；没有官方名次时为 null。 */
  sourceRank: number | null
  agentId: string
  agentName: string
  agentVersion: string | null
  modelName: string
  modelVariant: string | null
  /** 主指标值；缺失时显示「—」，不填 0。 */
  values: Record<string, number | null>
  date: string | null
  taskCount: number | null
  attempts: number | null
  sourceUrl: string
}

export interface AiAgentArenaBoard {
  id: AiAgentArenaSourceId
  name: string
  version: string | null
  description: string
  /** 官方数据时间；静态榜单为页面导出的时间。 */
  capturedAt: string | null
  taskCount: number | null
  attemptsPerTask: number | null
  /** 默认排序指标；对应 columns 中的一项。 */
  primaryMetric: string
  columns: AiAgentArenaColumn[]
  entries: AiAgentArenaEntry[]
  sourceUrl: string
  notes: string[]
}

export interface AiAgentArenaSourceState {
  ok: boolean
  /** 最近一次成功抓取时间；失败时保留上次成功时间。 */
  fetchedAt: string | null
  /** 最近一次检查时间，包括 304 与失败。 */
  checkedAt: string | null
  /** 来源失败或数据不完整时的简短说明。 */
  note?: string
}

export interface AiAgentArenaSnapshot {
  generatedAt: string
  sources: Record<AiAgentArenaSourceId, AiAgentArenaSourceState>
  boards: AiAgentArenaBoard[]
}

export interface AiAgentArenaQuery {
  /** 只读本地缓存；没有缓存时仍会尝试采集。 */
  allowStale?: boolean
  /** 跳过各来源 TTL，强制请求原始数据。 */
  force?: boolean
}

export interface AiAgentArenaResult {
  snapshot: AiAgentArenaSnapshot
  fetchedAtMs: number
  source: 'network' | 'cache'
  stale: boolean
  warning: string | null
}

/** 三个来源的固定页面；主进程只允许打开这些地址。 */
export const AI_AGENT_ARENA_SOURCES: ReadonlyArray<{
  id: AiAgentArenaSourceId
  label: string
  url: string
  note: string
}> = [
  {
    id: 'codeagentbench',
    label: 'CodeAgentBench',
    url: 'https://suyoumo.github.io/code-agent-bench/',
    note: 'SWE-Bench-Pro Agent × 模型；官方 Final Score'
  },
  {
    id: 'terminal-bench',
    label: 'Terminal-Bench',
    url: 'https://www.tbench.ai/',
    note: '终端任务 Agent × 模型；官方 Resolution Rate'
  },
  {
    id: 'frontierharness',
    label: 'FrontierHarness',
    url: 'https://frontierharness.org/efficiency/',
    note: 'Agent harness 效率榜；官方 Cost per pass'
  }
]

/** 各来源的自动检查间隔；页面保持打开时按此判断是否刷新。 */
export const AI_AGENT_ARENA_TTL_MS: Record<AiAgentArenaSourceId, number> = {
  codeagentbench: 12 * 60 * 60 * 1000,
  'terminal-bench': 60 * 60 * 1000,
  frontierharness: 15 * 60 * 1000
}

/** 页面可见且停留在 Agent 榜时的检查频率；真正请求仍受各来源 TTL 约束。 */
export const AI_AGENT_ARENA_CHECK_INTERVAL_MS = 5 * 60 * 1000

export const AI_AGENT_ARENA_SOURCE_LABELS: Record<AiAgentArenaSourceId, string> = {
  codeagentbench: 'CodeAgentBench',
  'terminal-bench': 'Terminal-Bench',
  frontierharness: 'FrontierHarness'
}
