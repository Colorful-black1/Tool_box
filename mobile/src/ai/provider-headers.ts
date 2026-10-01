/**
 * 供应商要求的额外请求头 —— 与桌面端 `provider-headers.ts` 行为对齐。
 *
 * 为什么不复用桌面端那个文件：它 `import { randomUUID } from 'node:crypto'`，
 * Metro 解析不了 `node:*`。这里按同样的判定规则重写一份纯逻辑，
 * 并在 verify:data 里用桌面的实现做交叉校验，确保两边行为不漂移。
 *
 * OpenCode Go 的硬性要求（https://opencode.ai/docs/go/#where-can-i-use-it）：
 * 每个会话必须带稳定的 `x-opencode-session`，否则直接返回 400
 * 「Request is missing x-opencode-session and cannot be routed efficiently」。
 * 该 session id 必须**逐轮稳定**（取 conversationId），不能每请求随机，
 * 否则 prompt 缓存全部失效。
 */
import type { AiProviderId } from '../shared-bridge'

export const OPENCODE_SESSION_HEADER = 'x-opencode-session'

/**
 * 客户端标识：不能是通用 SDK / HTTP 库名。
 * 桌面端是 `tool-box-electron`，手机端对应 `tool-box-mobile`。
 */
export const CLIENT_USER_AGENT = 'tool-box-mobile'

export interface ProviderHeaderInput {
  provider: AiProviderId
  baseUrl: string
  /** 会话内稳定不变；单次调用可用一次性 id */
  sessionId: string
}

/**
 * 自定义端点也可能就是 Go 网关，所以除 provider 外再按 host + 路径兜底识别。
 * 注意 `https://opencode.ai/zen/v1`（Zen）不需要，Go 才是 `/zen/go`。
 */
export function requiresSessionHeader(input: {
  provider: AiProviderId
  baseUrl: string
}): boolean {
  if (input.provider === 'opencode-go') return true
  try {
    const url = new URL(input.baseUrl)
    return url.hostname === 'opencode.ai' && url.pathname.includes('/zen/go')
  } catch {
    return false
  }
}

/** 当前目标是否需要替换 User-Agent（与需要会话头的供应商一致） */
export function requiresCustomUserAgent(input: {
  provider: AiProviderId
  baseUrl: string
}): boolean {
  return requiresSessionHeader(input)
}

/** 按供应商追加必要的请求头；其余 OpenAI 兼容供应商返回空对象 */
export function buildProviderHeaders(input: ProviderHeaderInput): Record<string, string> {
  if (!requiresSessionHeader(input)) return {}
  return { [OPENCODE_SESSION_HEADER]: input.sessionId }
}

/**
 * 组装拉取模型列表的请求头。
 * 部分供应商（OpenCode Go）对模型列表同样要求客户端标识与稳定会话 ID，
 * 否则模型列表也拉不到。
 */
export function buildModelListHeaders(input: {
  provider: AiProviderId
  baseUrl: string
  apiKey: string
  sessionId: string
}): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    Authorization: `Bearer ${input.apiKey}`,
    ...buildProviderHeaders({ provider: input.provider, baseUrl: input.baseUrl, sessionId: input.sessionId })
  }
  if (requiresCustomUserAgent({ provider: input.provider, baseUrl: input.baseUrl })) {
    headers['User-Agent'] = CLIENT_USER_AGENT
  }
  return headers
}

/** 组装流式对话的完整请求头 */
export function buildChatHeaders(input: {
  provider: AiProviderId
  baseUrl: string
  apiKey: string
  sessionId: string
}): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
    Authorization: `Bearer ${input.apiKey}`,
    ...buildProviderHeaders({ provider: input.provider, baseUrl: input.baseUrl, sessionId: input.sessionId })
  }
  if (requiresCustomUserAgent({ provider: input.provider, baseUrl: input.baseUrl })) {
    headers['User-Agent'] = CLIENT_USER_AGENT
  }
  return headers
}