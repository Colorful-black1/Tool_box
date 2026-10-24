import type { UsageClient, UsageCost, UsageTokens } from '../../../shared/agent-usage'

/** 采集器唯一允许缓存的数据投影，不含消息文本和原始 JSON。 */
export interface UsageRecord {
  snapshot?: boolean
  client: UsageClient
  sessionId: string
  id: string
  project: string
  model: string
  time: number | null
  tokens: UsageTokens
  /** 原生上报花费（USD）；来源不提供时为 null。 */
  costUsd: number | null
  requests: number | null
  partial: boolean
}

export function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

export function text(value: unknown): string {
  return typeof value === 'string' ? value.slice(0, 4096) : ''
}

export function count(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
}

export function timestamp(value: unknown): number | null {
  const n = typeof value === 'string' ? Date.parse(value) : count(value)
  return n !== null && Number.isFinite(n) && n >= 0 && n <= 8640000000000000 ? n : null
}

/** 花费允许小数；非数字、负数与溢出值保持未知，不能伪装成免费。 */
export function money(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  return Number.isFinite(n) && n >= 0 && n <= 1_000_000 ? Math.round(n * 1e6) / 1e6 : null
}

/** 旧版 OpenCode 会把模型对象序列化进文本字段；展示与前缀过滤都要回到模型 ID。 */
export function modelLabel(value: unknown): string {
  const raw = text(value)
  if (!raw.startsWith('{')) return raw
  try {
    const parsed = object(JSON.parse(raw))
    return text(parsed.id) || text(parsed.modelID) || text(parsed.model)
  } catch {
    return ''
  }
}

export function sum(values: (number | null)[]): number | null {
  if (values.some((v) => v === null)) return null
  return count(values.reduce<number>((a, b) => a + (b ?? 0), 0))
}

/** 显式声明字段关系，禁止缓存或推理在已包含的输入 / 输出中重复累加。 */
export function normalizeTokens(
  raw: {
    input?: unknown
    output?: unknown
    cacheRead?: unknown
    cacheWrite?: unknown
    reasoning?: unknown
    total?: unknown
  },
  cache: 'included' | 'separate',
  reasoning: 'included' | 'separate' = 'included',
  cacheWriteInTotal = true
): UsageTokens {
  const input = count(raw.input)
  const output = count(raw.output)
  const read = count(raw.cacheRead)
  const write = count(raw.cacheWrite)
  const thought = count(raw.reasoning)
  const fresh =
    cache === 'included' && input !== null
      ? read === null
        ? null
        : count(input - read - (cacheWriteInTotal ? (write ?? 0) : 0))
      : input
  const total =
    count(raw.total) ??
    sum([
      input,
      output,
      ...(cache === 'separate' ? [read, ...(cacheWriteInTotal ? [write] : [])] : []),
      ...(reasoning === 'separate' ? [thought] : [])
    ])
  return { input: fresh, output, cacheRead: read, cacheWrite: write, reasoning: thought, total }
}

/** 汇总已知值，缺失信息由调用方的 partial 保留，所有值未知时保持 null。 */
export function aggregateTokens(rows: UsageTokens[]): UsageTokens {
  const result: UsageTokens = {
    input: null,
    output: null,
    cacheRead: null,
    cacheWrite: null,
    reasoning: null,
    total: null
  }
  for (const key of Object.keys(result) as (keyof UsageTokens)[]) {
    const known = rows.map((r) => r[key]).filter((v): v is number => v !== null)
    result[key] = known.length ? sum(known) : null
  }
  return result
}

export function usageRecord(
  client: UsageClient,
  sessionId: string,
  id: string,
  tokens: UsageTokens,
  meta: {
    project?: unknown
    model?: unknown
    time?: unknown
    cost?: unknown
    requests?: number | null
    partial?: boolean
  } = {}
): UsageRecord {
  return {
    client,
    sessionId,
    id,
    tokens,
    project: text(meta.project),
    model: modelLabel(meta.model),
    time: timestamp(meta.time),
    costUsd: money(meta.cost),
    requests:
      meta.requests === undefined
        ? tokens.total === null && tokens.input === null && tokens.output === null
          ? null
          : 1
        : meta.requests,
    partial: Boolean(
      meta.partial || tokens.total === null || tokens.input === null || tokens.output === null
    )
  }
}

/** 花费只累加已知值；reported / total 让界面能说明覆盖度，而不是把缺失当成 0。 */
export function aggregateCost(values: (number | null)[]): UsageCost {
  const known = values.filter((value): value is number => value !== null)
  return {
    usd: known.length ? money(known.reduce((total, value) => total + value, 0)) : null,
    reported: known.length,
    total: values.length
  }
}
