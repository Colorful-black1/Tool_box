import type {
  UsageBreakdown,
  UsageDaily,
  UsageQuery,
  UsageReport,
  UsageSessionView,
  UsageSortKey,
  UsageSourceView
} from '../../../shared/agent-usage'
import { aggregateCost, aggregateTokens, count, money, sum } from './normalize'
import type { UsageRecord } from './normalize'

export function localDate(time: number): string {
  const d = new Date(time)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 5000
const BREAKDOWN_LIMIT = 8
const TREND_LIMIT = 90

/** 空值排在最后，再按身份稳定排序，避免翻页时同一批记录换位置。 */
function compareRows(a: UsageSessionView, b: UsageSessionView, key: UsageSortKey, desc: boolean) {
  const value = (row: UsageSessionView): number | null =>
    key === 'time' ? row.time : key === 'cost' ? row.costUsd : row.tokens[key]
  const left = value(a)
  const right = value(b)
  if (left === null && right === null) return a.sessionId.localeCompare(b.sessionId)
  if (left === null) return 1
  if (right === null) return -1
  if (left !== right) return desc ? right - left : left - right
  return a.sessionId.localeCompare(b.sessionId) || a.model.localeCompare(b.model)
}

function breakdown(rows: UsageRecord[], key: (row: UsageRecord) => string): UsageBreakdown[] {
  const groups = new Map<string, UsageRecord[]>()
  for (const row of rows) {
    const name = key(row)
    const group = groups.get(name) ?? []
    group.push(row)
    groups.set(name, group)
  }
  return [...groups]
    .map(([name, group]) => {
      const cost = aggregateCost(group.map((row) => row.costUsd))
      return {
        key: name,
        tokens: aggregateTokens(group.map((row) => row.tokens)),
        costUsd: cost.usd,
        costPartial: cost.reported > 0 && cost.reported < cost.total,
        requests: sum(group.map((row) => row.requests)),
        sessions: new Set(group.map((row) => JSON.stringify([row.client, row.sessionId]))).size
      }
    })
    .sort(
      (a, b) =>
        (b.tokens.total ?? -1) - (a.tokens.total ?? -1) ||
        (b.requests ?? -1) - (a.requests ?? -1) ||
        a.key.localeCompare(b.key)
    )
    .slice(0, BREAKDOWN_LIMIT)
}

/** 每日按 Agent 堆叠；没有记录的日期不补零，避免把未知当成零用量。 */
function daily(rows: UsageRecord[]): UsageDaily[] {
  const days = new Map<string, UsageRecord[]>()
  for (const row of rows) {
    if (row.time === null) continue
    const date = localDate(row.time)
    const group = days.get(date) ?? []
    group.push(row)
    days.set(date, group)
  }
  return [...days]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, group]) => {
      const clients = new Map<string, UsageRecord[]>()
      for (const row of group) {
        const list = clients.get(row.client) ?? []
        list.push(row)
        clients.set(row.client, list)
      }
      return {
        date,
        total: aggregateTokens(group.map((row) => row.tokens)).total,
        clients: [...clients]
          .map(([client, values]) => ({
            client: client as UsageRecord['client'],
            total: aggregateTokens(values.map((row) => row.tokens)).total
          }))
          .sort((a, b) => (b.total ?? -1) - (a.total ?? -1))
      }
    })
}

/** 所有视图从同一份去重记录和日期边界汇总，筛选不会另起一次原生调用。 */
export function usageReport(
  records: UsageRecord[],
  sources: UsageSourceView[],
  scannedAt: number,
  query: UsageQuery
): UsageReport {
  const globalIds = new Set([
    'claude',
    'pi',
    'workbuddy',
    'opencode',
    'zcode',
    'mimocode',
    'copilot',
    'mcode'
  ])
  const unique = new Map<string, UsageRecord>()
  for (const row of records) {
    const key = JSON.stringify([row.client, globalIds.has(row.client) ? '' : row.sessionId, row.id])
    const previous = unique.get(key)
    if (
      !previous ||
      (row.time ?? -1) > (previous.time ?? -1) ||
      (row.time === previous.time && (row.tokens.total ?? -1) >= (previous.tokens.total ?? -1))
    )
      unique.set(key, row)
  }
  const dedup = [...unique.values()]
  const all = dedup.filter((r) => !r.snapshot)
  const detailBySession = new Map<string, UsageRecord[]>()
  for (const row of all) {
    const key = JSON.stringify([row.client, row.sessionId])
    const group = detailBySession.get(key) ?? []
    group.push(row)
    detailBySession.set(key, group)
  }
  const snapshots = new Map<string, UsageRecord>()
  for (const row of records.filter((r) => r.snapshot)) {
    const key = JSON.stringify([row.client, row.sessionId])
    if ((row.tokens.total ?? -1) >= (snapshots.get(key)?.tokens.total ?? -1))
      snapshots.set(key, row)
  }
  // 日志可能从半途开始或新旧格式共存。原生累计只补明细之外的差值，不伪造日期 / 模型。
  for (const snapshot of snapshots.values()) {
    const detail = detailBySession.get(JSON.stringify([snapshot.client, snapshot.sessionId])) ?? []
    const known = aggregateTokens(detail.map((r) => r.tokens))
    const total = snapshot.tokens.total
    if (total === null || total <= (known.total ?? 0)) continue
    const tokens = { ...snapshot.tokens }
    for (const key of Object.keys(tokens) as (keyof typeof tokens)[])
      tokens[key] =
        tokens[key] === null || detail.some((r) => r.tokens[key] === null)
          ? null
          : count(tokens[key]! - (known[key] ?? 0))
    all.push({
      ...snapshot,
      snapshot: false,
      id: 'cumulative-gap',
      model: '',
      time: null,
      tokens,
      costUsd: null,
      partial: true
    })
  }
  const context = all.filter((r) => !query.client || r.client === query.client)
  const unknownTime = context.filter(
    (r) =>
      r.time === null &&
      (!query.project || r.project === query.project) &&
      (!query.model || r.model === query.model)
  ).length
  const rows = context.filter((r) => {
    if ((query.project && r.project !== query.project) || (query.model && r.model !== query.model))
      return false
    if (r.time === null) return !query.from && !query.to
    const day = localDate(r.time)
    return (!query.from || day >= query.from) && (!query.to || day <= query.to)
  })
  const grouped = new Map<string, UsageRecord[]>()
  for (const row of rows) {
    const key = JSON.stringify([row.client, row.sessionId, row.project, row.model])
    const group = grouped.get(key) ?? []
    group.push(row)
    grouped.set(key, group)
  }
  const sessions: UsageSessionView[] = [...grouped.values()].map((group) => {
    const cost = aggregateCost(group.map((row) => row.costUsd))
    return {
      client: group[0].client,
      sessionId: group[0].sessionId,
      project: group[0].project,
      model: group[0].model,
      time: group.reduce<number | null>(
        (time, r) => (r.time === null ? time : Math.max(time ?? 0, r.time)),
        null
      ),
      tokens: aggregateTokens(group.map((r) => r.tokens)),
      requests: sum(group.map((r) => r.requests)),
      costUsd: cost.usd,
      costPartial: cost.reported > 0 && cost.reported < cost.total,
      partial: group.some((r) => r.partial)
    }
  })
  const sort = query.sort ?? 'time'
  const desc = query.desc ?? true
  sessions.sort((a, b) => compareRows(a, b, sort, desc))
  const limit = Math.min(Math.max(query.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT)
  const offset = query.offset ?? 0
  const relevantSources = sources.filter((s) => !query.client || s.client === query.client)
  const trendRows = context.filter(
    (r) =>
      (!query.project || r.project === query.project) && (!query.model || r.model === query.model)
  )
  const cost = aggregateCost(rows.map((row) => row.costUsd))
  return {
    scannedAt,
    sources,
    tokens: aggregateTokens(rows.map((r) => r.tokens)),
    cost: { ...cost, usd: money(cost.usd) },
    requests: rows.length ? sum(rows.map((r) => r.requests)) : null,
    sessions: new Set(rows.map((r) => JSON.stringify([r.client, r.sessionId]))).size,
    partial:
      rows.some((r) => r.partial) ||
      relevantSources.some((s) => s.status === 'partial' || s.status === 'error'),
    unknownTime,
    projects: [...new Set(context.map((r) => r.project).filter(Boolean))].sort(),
    models: [...new Set(context.map((r) => r.model).filter(Boolean))].sort(),
    byClient: relevantSources.flatMap((source) => {
      const values = rows.filter((r) => r.client === source.client)
      return values.length
        ? [
            {
              client: source.client,
              tokens: aggregateTokens(values.map((r) => r.tokens)),
              costUsd: aggregateCost(values.map((r) => r.costUsd)).usd
            }
          ]
        : []
    }),
    byModel: breakdown(rows, (row) => row.model),
    byProject: breakdown(rows, (row) => row.project),
    daily: daily(rows),
    trend: daily(trendRows).slice(-TREND_LIMIT),
    rows: sessions.slice(offset, offset + limit),
    rowCount: sessions.length
  }
}
