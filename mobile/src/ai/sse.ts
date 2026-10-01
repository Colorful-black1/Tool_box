/**
 * SSE（Server-Sent Events）增量解析器 —— 手机端自写流式对话的核心。
 *
 * 为什么不用现成库：桌面端把流式交给 LangChain / openai SDK，手机端不搬 LangChain
 * （体积大且含 Node 依赖），所以必须自己实现 OpenAI 兼容端点的 SSE 解析。
 *
 * 设计要点（本文件的每个分支都对应一个真实会踩的坑）：
 * 1. **chunk 边界**：网络分块与 SSE 的行/事件边界无关，一个 JSON 会被切成任意位置。
 *    所以必须保留半行缓冲，不能按 chunk 解析。
 * 2. **多行 data**：SSE 允许一个事件有多行 data，要用 `\n` 连接后再 JSON.parse。
 * 3. **`\r\n` 与 `\n` 混用**：部分网关只发 `\n`，部分发 `\r\n`，都要支持。
 * 4. **注释行**：以 `:` 开头的行是注释（如心跳 `: ping`），必须忽略，
 *    否则会往 data 上拼垃圾导致 JSON.parse 失败。
 * 5. **空行即分隔**：事件之间用空行分隔，且事件以空行结尾才算完整。
 *
 * 本文件不 import 任何 Node / RN 模块，因此可在 vitest 中直接测试。
 */

/** 一个已完成的 SSE 事件；`event` 为 null 表示服务端没写 `event:` 字段（OpenAI 的常态） */
export interface SseEvent {
  event: string | null
  data: string
}

const DONE = '[DONE]'

export class SseParser {
  /** 事件内部已读到的 data 行（尚未遇到空行，事件还不完整） */
  private lines: string[] = []
  /** 事件名	让`event:` 字段可能在 data 之前或之后出现*/
  private eventName: string | null = null
  /** 事件名；`event:` 字段可能在 data 之前或之后出现 */
  /** 半行缓冲：最后一个 chunk 结尾处没有换行符的那段 */
  private buffer = ''

  /**
   * 喂入一段解码后的文本，返回本次可以确定的完整事件列表。
   * 允许一个 chunk 里含 0 个、半个或多个事件。
   */
  push(chunk: string): SseEvent[] {
    const events: SseEvent[] = []
    const text = this.buffer + chunk
    // 按行切，但保留最后一段不完整的行到下一次
    const parts = text.split('\n')
    this.buffer = parts.pop() ?? ''

    for (const rawLine of parts) {
      // 去掉行尾 \r（兼容 \r\n）
      const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine
      const event = this.consumeLine(line)
      if (event) events.push(event)
    }
    return events
  }

  /**
   * 收尾：部分服务端在响应结束时**不发**最后的空行。
   * 此时把挂起的事件当作完整事件吐出，否则最后一段回复会丢。
   */
  flush(): SseEvent[] {
    const events: SseEvent[] = []
    if (this.buffer) {
      const line = this.buffer.endsWith('\r') ? this.buffer.slice(0, -1) : this.buffer
      this.buffer = ''
      const event = this.consumeLine(line)
      if (event) events.push(event)
    }
    const last = this.takeEvent()
    if (last) events.push(last)
    return events
  }

  /** 处理一行，返回非空表示攒够了一个完整事件 */
  private consumeLine(line: string): SseEvent | null {
    // 空行 = 事件分隔符
    if (line === '') return this.takeEvent()
    // 注释 / 心跳
    if (line.startsWith(':')) return null

    const colon = line.indexOf(':')
    const field = colon === -1 ? line : line.slice(0, colon)
    // 规范：冒号后紧跟的**一个**空格要去掉；没有冒号则整个行是 field，value 为空串
    let value = colon === -1 ? '' : line.slice(colon + 1)
    if (value.startsWith(' ')) value = value.slice(1)

    if (field === 'data') this.lines.push(value)
    else if (field === 'event') this.applyEventField(value)
    return null
  }


  private takeEvent(): SseEvent | null {
    if (this.lines.length === 0) {
      this.eventName = null
      return null
    }
    const data = this.lines.join('\n')
    const event = this.eventName
    this.lines = []
    this.eventName = null
    return { event, data }
  }

  private applyEventField(value: string): void {
    this.eventName = value
  }
}

/** 保留给 stream-chat 用的便捷函数：判断是否流结束 */
export function isDoneSentinel(event: SseEvent): boolean {
  return event.data.trim() === DONE
}

/**
 * 从一个 SSE 事件的 JSON 负载里取出增量文本。
 * 对应 OpenAI `choices[0].delta.content`。
 *
 * 返回空串表示「本次没有增量」，调用方必须跳过 —— 首个 chunk 只有 role、
 * 末个 chunk 只有 finish_reason，中间也可能有多模态数组块。
 */
export function extractDelta(payload: unknown): string {
  const choice = firstChoice(payload)
  if (!choice) return ''

  const delta = choice['delta']
  if (typeof delta !== 'object' || delta === null) return ''
  return readText((delta as Record<string, unknown>)['content'])
}

/** 兼容 content 为字符串或 content block 数组两种形态 */
function readText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''

  return content
    .map((part) => {
      if (typeof part === 'string') return part
      if (typeof part !== 'object' || part === null) return ''
      const text = (part as Record<string, unknown>)['text']
      return typeof text === 'string' ? text : ''
    })
    .join('')
}

/** 流式负载第一块选择；兼容非流式 `choices[0].message` 便于一次性调用复用 */
export function firstChoice(payload: unknown): Record<string, unknown> | null {
  if (typeof payload !== 'object' || payload === null) return null

  const choices = (payload as Record<string, unknown>)['choices']
  if (!Array.isArray(choices) || choices.length === 0) return null

  const choice = choices[0]
  if (typeof choice !== 'object' || choice === null) return null
  return choice as Record<string, unknown>
}

/** 非流式响应取正文，供「一次性调用」场景复用同一个解析器 */
export function extractMessageContent(payload: unknown): string {
  const choice = firstChoice(payload)
  if (!choice) return ''
  const message = choice['message']
  if (typeof message !== 'object' || message === null) return ''
  return readText((message as Record<string, unknown>)['content'])
}

/**
 * 从负载里取服务端错误信息。
 * 命中后交由桌面的 `describeAiError` 映射为用户可读文案（401/429/超时等）。
 */
export function extractErrorMessage(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) return null

  const error = (payload as Record<string, unknown>)['error']
  if (typeof error === 'string' && error.trim()) return error
  if (typeof error === 'object' && error !== null) {
    const message = (error as Record<string, unknown>)['message']
    if (typeof message === 'string' && message.trim()) return message
    const type = (error as Record<string, unknown>)['type']
    if (typeof type === 'string' && type.trim()) return type
  }

  const message = (payload as Record<string, unknown>)['message']
  if (typeof message === 'string' && message.trim()) return message
  return null
}