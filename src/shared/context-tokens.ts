/**
 * 上下文 Token 估算（桌面端共用）。
 *
 * 没有引入 tiktoken：DeepSeek / Qwen / Kimi 的分词器与 OpenAI 不同，
 * 离线可用的 rank 文件也不能覆盖所有供应商。这里用「字符 + 结构开销」
 * 的保守估算，精确值优先取供应商返回的 usage_metadata。
 *
 * 中文按 1 字 ≈ 1 token：对 DeepSeek / Qwen 略偏高，对较老的 OpenAI
 * 分词器略偏低；误差由安全余量和溢出恢复兜底，界面一律显示「约」。
 */

/** 每条消息的角色、分隔符等结构开销 */
export const MESSAGE_OVERHEAD_TOKENS = 8

/** 每个工具定义除 JSON 正文外的结构开销 */
const TOOL_OVERHEAD_TOKENS = 8

/** 非中文文本的字符 / token 比：英文约 4，取 3.5 留一点余量 */
const NON_CJK_CHARS_PER_TOKEN = 3.5

/** 估算一段文本的 token 数（空文本为 0） */
export function estimateTextTokens(text: string): number {
  if (!text) return 0

  let cjk = 0
  let other = 0
  for (const char of text) {
    if (isCjkChar(char)) cjk += 1
    else other += char.length
  }

  return Math.ceil(cjk + other / NON_CJK_CHARS_PER_TOKEN)
}

/** 一条聊天消息的估算，包含固定的消息结构开销 */
export function estimateMessageTokens(message: { content: string }): number {
  return estimateTextTokens(message.content) + MESSAGE_OVERHEAD_TOKENS
}

/** 一组聊天消息的估算 */
export function estimateMessagesTokens(messages: ReadonlyArray<{ content: string }>): number {
  let total = 0
  for (const message of messages) total += estimateMessageTokens(message)
  return total
}

/**
 * 工具定义的估算。
 *
 * 工具 schema 以中英文描述为主，直接对 JSON 文本做同一套字符估算，
 * 再为每个工具加固定的结构开销；无法序列化时退回字符串长度。
 */
export function estimateToolsTokens(tools: ReadonlyArray<unknown>): number {
  if (tools.length === 0) return 0

  let total = 0
  for (const tool of tools) {
    let text: string
    try {
      text = JSON.stringify(tool) ?? ''
    } catch {
      // 循环引用等异常只影响估算，不能阻断上下文计算
      text = String(tool)
    }
    total += estimateTextTokens(text) + TOOL_OVERHEAD_TOKENS
  }
  return total
}

/**
 * CJK 字符范围：中日韩统一表意文字、扩展 A、兼容表意文字、
 * 中日文假名、中文标点与全角字符。
 */
function isCjkChar(char: string): boolean {
  const code = char.codePointAt(0) ?? 0
  return (
    (code >= 0x2e80 && code <= 0x2eff) ||
    (code >= 0x3000 && code <= 0x303f) ||
    (code >= 0x3040 && code <= 0x30ff) ||
    (code >= 0x3400 && code <= 0x4dbf) ||
    (code >= 0x4e00 && code <= 0x9fff) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xff00 && code <= 0xffef)
  )
}
