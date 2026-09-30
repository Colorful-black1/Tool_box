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

export function describeAiError(error: unknown, secret = ''): string {
  const raw = error instanceof Error ? error.message : String(error)
  const message = redactSecret(raw, secret)

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
