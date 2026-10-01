import { randomUUID } from 'node:crypto'

import type { AiProviderId } from '../../../shared/types'

/** OpenCode Go 用它做路由与 prompt 缓存，缺失直接返回 400 */
export const OPENCODE_SESSION_HEADER = 'x-opencode-session'

/** 供应商要求客户端自带 UA，不能是通用 SDK / HTTP 库名称 */
export const CLIENT_USER_AGENT = 'tool-box-electron'

export interface ProviderHeaderInput {
  provider: AiProviderId
  baseUrl: string
  /** 会话内稳定不变；单次调用可用一次性 id */
  sessionId: string
}

/**
 * 按供应商追加必要的请求头。
 *
 * 目前仅 OpenCode Go 有强制要求（见 https://opencode.ai/docs/go/#where-can-i-use-it）：
 * 必须为每个会话发送稳定的 `x-opencode-session`，否则报
 * 400「Request is missing x-opencode-session and cannot be routed efficiently」。
 * 其余 OpenAI 兼容供应商不需要额外头，返回空对象。
 *
 * 注意：User-Agent 不在这里下发 —— LangChain 会把自有 UA 前置拼接成
 * `langchainjs-openai/x.y.z (<runtime>)<ours>`，仍以通用 SDK 名开头，
 * 因此改由 {@link withPinnedUserAgent} 在 fetch 层精确改写。
 */
export function buildProviderHeaders(input: ProviderHeaderInput): Record<string, string> {
  if (!requiresSessionHeader(input.provider, input.baseUrl)) return {}
  return { [OPENCODE_SESSION_HEADER]: input.sessionId }
}

/** 当前目标是否需要替换 User-Agent（与需要会话头的供应商一致） */
export function requiresCustomUserAgent(input: ProviderHeaderInput): boolean {
  return requiresSessionHeader(input.provider, input.baseUrl)
}

/**
 * 包装 fetch，把 User-Agent 固定为自有标识，其余请求头原样保留。
 * 只覆盖 UA 这一个键，不动 Authorization / x-opencode-session。
 */
export function withPinnedUserAgent(inner: typeof fetch): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const headers = new Headers(init?.headers)
    headers.set('User-Agent', CLIENT_USER_AGENT)
    return inner(input, { ...init, headers })
  }
}

/** 自定义端点也可能是 Go 网关，因此除 provider 外再按 host + 路径兜底识别 */
function requiresSessionHeader(provider: AiProviderId, baseUrl: string): boolean {
  if (provider === 'opencode-go') return true
  try {
    const url = new URL(baseUrl)
    return url.hostname === 'opencode.ai' && url.pathname.includes('/zen/go')
  } catch {
    return false
  }
}

/** 一次性调用（如密码箱 AI 识别）没有会话概念，用进程级稳定 id 兜底 */
let processSessionId: string | null = null

export function processSessionIdForSingleCall(): string {
  if (!processSessionId) processSessionId = randomUUID()
  return processSessionId
}
