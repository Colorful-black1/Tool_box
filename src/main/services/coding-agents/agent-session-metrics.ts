import type { AgentContextUsage } from '../../../shared/agent-session'
import { acpObject } from './stdio-rpc-connection'

const tokens = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0

/** 上游数字也必须校验；允许仅有分子，不把无效窗口当成零使用率。 */
export function contextUsage(
  used: unknown,
  size: unknown,
  source: AgentContextUsage['source'],
  approximate = false,
  model?: string,
  windowKind: AgentContextUsage['windowKind'] = 'context'
): AgentContextUsage | undefined {
  if (!tokens(used)) return undefined
  return {
    usedTokens: used,
    windowTokens: tokens(size) && size > 0 ? size : null,
    source,
    approximate,
    measuredAt: Date.now(),
    windowKind,
    ...(model && model.length <= 200 ? { model } : {})
  }
}

/** 只取 last 请求的上下文压力，绝不使用累计 total。 */
export function codexContextUsage(raw: unknown): AgentContextUsage | undefined {
  const usage = acpObject(raw)
  const last = acpObject(usage?.last)
  return contextUsage(last?.totalTokens, usage?.modelContextWindow, 'codex')
}

/** 控制接口与消息附带结构使用不同命名，均只返回白名单字段。 */
export function claudeContextUsage(raw: unknown): AgentContextUsage | undefined {
  const usage = acpObject(raw)
  return contextUsage(
    usage?.totalTokens ?? usage?.total_tokens,
    usage?.rawMaxTokens ?? usage?.raw_max_tokens,
    'claude',
    true,
    typeof usage?.model === 'string' ? usage.model : undefined,
    'compaction'
  )
}
