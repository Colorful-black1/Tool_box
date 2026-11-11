import { MAX_INPUT_CHARS } from '../../../shared/constants'

export class AiGatewayError extends Error {
  readonly userMessage: string

  constructor(userMessage: string, cause?: unknown) {
    super(userMessage, { cause })
    this.name = 'AiGatewayError'
    this.userMessage = userMessage
  }
}

export function normalizeOpenAiBaseUrl(input: string): string {
  const trimmed = input.trim().replace(/\/+$/, '')
  if (!trimmed) return ''

  let value = trimmed
  if (value.toLowerCase().endsWith('/chat/completions')) {
    value = value.slice(0, -'/chat/completions'.length).replace(/\/+$/, '')
  }

  try {
    const url = new URL(value)
    const path = url.pathname.replace(/\/+$/, '')
    const hasVersion =
      /(^|\/)v\d+(?:\.\d+)?$/i.test(path) || /(^|\/)v\d+(?:\.\d+)?\//i.test(path)
    if (!hasVersion) {
      url.pathname = `${path}/v1`
    }
    return url.toString().replace(/\/+$/, '')
  } catch {
    return value
  }
}

export function validateChatInput(content: string): string {
  const trimmed = content.trim()
  if (!trimmed) {
    throw new AiGatewayError('消息内容不能为空')
  }
  if (trimmed.length > MAX_INPUT_CHARS) {
    throw new AiGatewayError(`消息过长（${trimmed.length} 字符），请拆分后发送`)
  }
  return trimmed
}

export function redactSecret(text: string, secret: string): string {
  if (!secret || secret.length < 8) return text
  return text.replaceAll(secret, '[已隐藏]')
}

/** 供应商确认「请求超出上下文窗口」；用于决定是否强制压缩后重试一次 */
export function isContextOverflowError(error: unknown): boolean {
  const message = errorText(error)
  return (
    /context_length_exceeded/i.test(message) ||
    /maximum context length/i.test(message) ||
    /context window/i.test(message) ||
    /too many tokens/i.test(message) ||
    /prompt is too long/i.test(message) ||
    /input is too long/i.test(message) ||
    /reduce the length of the messages/i.test(message)
  )
}

/**
 * 从错误文案里解析真实上限，例如：
 * - maximum context length is 131072 tokens
 * - context window of 200000
 * - context_length_exceeded: 32768
 * 只接受 4k–10M 的整数，避免把错误里的其它数字误当成窗口。
 */
export function parseContextLimit(error: unknown): number | null {
  const text = errorText(error)
  const patterns = [
    /maximum context length is\s+([\d,]+)\s+tokens/i,
    /maximum context length\s*[:=]?\s*([\d,]+)/i,
    /context window(?:\s+of|\s+is)?\s+([\d,]+)/i,
    /context_length_exceeded[^\d]*([\d,]+)/i,
    /reduce the length of the messages[^\d]*([\d,]+)/i
  ]
  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (!match) continue
    const value = Number(match[1].replaceAll(',', ''))
    if (Number.isInteger(value) && value >= 4_000 && value <= 10_000_000) return value
  }
  return null
}

export function describeAiError(error: unknown, secret = ''): string {
  const raw = error instanceof Error ? error.message : String(error)
  const message = redactSecret(raw, secret)

  if (isContextOverflowError(error)) {
    return '上下文超出模型窗口。可在对话标题栏的「上下文」面板里压缩，或调大窗口 / 新建对话。'
  }
  if (/401|unauthorized|invalid[_ ]api[_ ]key|invalid[_ ]token/i.test(message)) {
    return 'API Key 无效或没有访问权限'
  }
  if (/403|forbidden/i.test(message)) {
    return '没有访问该模型的权限'
  }
  if (/404|model[_ ]not[_ ]found|not[_ ]found/i.test(message)) {
    return '接口地址或模型名称可能不正确'
  }
  if (/429|rate[_ ]limit|quota/i.test(message)) {
    return '请求频率或额度受限，请稍后重试'
  }
  if (/timeout|etimedout|econnaborted/i.test(message)) {
    return 'AI 请求超时，请检查网络后重试'
  }
  if (/enotfound|econnrefused|fetch failed|network|certificate/i.test(message)) {
    return '无法连接 AI 服务，请检查网络或接口地址'
  }
  return message || 'AI 请求失败'
}

/** 拼接错误链上的文案；供应商常把真实原因放在 cause 里 */
function errorText(error: unknown): string {
  const parts: string[] = []
  const seen = new Set<unknown>()
  let current: unknown = error
  while (current !== undefined && current !== null && !seen.has(current)) {
    seen.add(current)
    if (current instanceof Error) {
      parts.push(current.message)
      current = current.cause
    } else if (typeof current === 'string') {
      parts.push(current)
      break
    } else {
      parts.push(String(current))
      break
    }
  }
  return parts.join(' ')
}
