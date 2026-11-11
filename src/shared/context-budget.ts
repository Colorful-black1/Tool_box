/**
 * 上下文预算计算（纯函数，主进程与渲染层都可复用）。
 *
 * 触发阈值参考 OpenCode / DeepSeek Harness：
 *   阈值 = min(窗口 × 0.8, 窗口 − 输出预留 − 安全余量)
 * 保留尾部参考 DeepSeek Harness：窗口（扣掉输出预留）的约 15%，
 * 上限 15k（OpenCode 默认 15k），下限 4k，避免小窗口保留过多。
 */

export const DEFAULT_CONTEXT_WINDOW_TOKENS = 128_000
export const MIN_CONTEXT_WINDOW_TOKENS = 4_000
export const MAX_CONTEXT_WINDOW_TOKENS = 10_000_000

/** 单次回答的输出预留；实际取 min(该值, 窗口的 25%) */
export const DEFAULT_OUTPUT_RESERVE_TOKENS = 8_192

/** 估算误差与请求结构波动的安全余量；实际取 min(该值, 窗口的 10%) */
export const DEFAULT_HEADROOM_TOKENS = 4_096

export const DEFAULT_KEEP_TOKENS = 15_000
export const MIN_KEEP_TOKENS = 4_000
export const MIN_TAIL_TOKENS = 1_000
export const SUMMARY_MAX_TOKENS = 2_000
export const MIN_FREE_TOKENS = 1_000
export const MIN_FREE_RATIO = 0.05
export const COMPACT_THRESHOLD_RATIO = 0.8

export interface ContextBudgetInput {
  windowTokens: number
  /** system prompt + 工具定义 + 消息结构开销，压缩省不掉 */
  fixedTokens: number
  reservedOutputTokens?: number
  headroomTokens?: number
}

export interface ContextBudget {
  windowTokens: number
  outputReserveTokens: number
  headroomTokens: number
  thresholdTokens: number
  /** 选段时保留的最近消息预算；已扣除固定开销与摘要上限 */
  keepTokens: number
  summaryMaxTokens: number
}

/** 窗口值是否可信；设置页与设置读取共用 */
export function isValidContextWindow(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    Number.isInteger(value) &&
    value >= MIN_CONTEXT_WINDOW_TOKENS &&
    value <= MAX_CONTEXT_WINDOW_TOKENS
  )
}

/** 按窗口与固定开销算触发阈值、保留尾部预算 */
export function resolveContextBudget(input: ContextBudgetInput): ContextBudget {
  const windowTokens = normalizeWindow(input.windowTokens)
  const fixedTokens = Math.max(0, Math.floor(input.fixedTokens))

  const outputReserveTokens = Math.max(
    0,
    Math.min(
      Math.floor(input.reservedOutputTokens ?? DEFAULT_OUTPUT_RESERVE_TOKENS),
      Math.floor(windowTokens * 0.25)
    )
  )
  const headroomTokens = Math.max(
    0,
    Math.min(Math.floor(input.headroomTokens ?? DEFAULT_HEADROOM_TOKENS), Math.floor(windowTokens * 0.1))
  )

  const thresholdTokens = Math.max(
    1_024,
    Math.floor(
      Math.min(
        windowTokens * COMPACT_THRESHOLD_RATIO,
        windowTokens - outputReserveTokens - headroomTokens
      )
    )
  )

  const desiredKeep = clamp(
    Math.floor((windowTokens - outputReserveTokens) * 0.15),
    MIN_KEEP_TOKENS,
    DEFAULT_KEEP_TOKENS
  )
  const keepTokens = Math.max(
    MIN_TAIL_TOKENS,
    Math.min(desiredKeep, thresholdTokens - fixedTokens - SUMMARY_MAX_TOKENS)
  )

  return {
    windowTokens,
    outputReserveTokens,
    headroomTokens,
    thresholdTokens,
    keepTokens,
    summaryMaxTokens: SUMMARY_MAX_TOKENS
  }
}

/** 摘要后是否真的释放了足够空间；不 shrink 的摘要不允许落库 */
export function hasShrunkEnough(sourceTokens: number, summaryTokens: number): boolean {
  if (summaryTokens <= 0) return false
  const freed = sourceTokens - summaryTokens
  return freed >= Math.max(MIN_FREE_TOKENS, Math.floor(sourceTokens * MIN_FREE_RATIO))
}

function normalizeWindow(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_CONTEXT_WINDOW_TOKENS
  return clamp(Math.floor(value), MIN_CONTEXT_WINDOW_TOKENS, MAX_CONTEXT_WINDOW_TOKENS)
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}
