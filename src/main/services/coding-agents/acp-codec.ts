import type { CodingAgentOption } from '../../../shared/coding-agents'
import type { NativeCodingSession } from './adapter'
import { redactData } from '../../../shared/redaction-tools'
import { acpObject } from './stdio-rpc-connection'

export function acpText(value: unknown, max = 512): string {
  return typeof value === 'string' ? value.slice(0, max) : ''
}

/** 对选择项逐项收窄，兼容 ACP 的分组模型选项，丢弃其他外部字段。 */
export function acpOptions(value: unknown): CodingAgentOption[] {
  if (!Array.isArray(value)) return []
  return value.slice(0, 12).flatMap((raw) => {
    const option = acpObject(raw)
    if (!option || option.type !== 'select' || !Array.isArray(option.options)) return []
    const options = option.options
      .flatMap((rawItem) => {
        const item = acpObject(rawItem)
        if (!item) return []
        const items = Array.isArray(item.options) ? item.options : [item]
        return items.slice(0, 500).flatMap((rawChoice) => {
          const choice = acpObject(rawChoice)
          const value = acpText(choice?.value)
          const label = acpText(choice?.name, 200)
          return value && label ? [{ value, label }] : []
        })
      })
      .slice(0, 1000)
    const id = acpText(option.id, 100)
    const currentValue = acpText(option.currentValue)
    if (!id || !options.some((choice) => choice.value === currentValue)) return []
    return [
      {
        id,
        name: acpText(option.name, 100),
        category: acpText(option.category, 100),
        currentValue,
        options
      }
    ]
  })
}

/** 操作预览复用本机脱敏，避免把常见凭据带进审批卡或错误提示。 */
export function acpPreview(value: unknown, agentName = 'Agent'): string {
  try {
    const text = typeof value === 'string' ? value : JSON.stringify(value ?? {})
    if (text.length > 20_000) return `操作内容较长，请在 ${agentName} 中检查后再决定`
    return redactData(text).output.slice(0, 4000)
  } catch {
    return `无法预览此操作，请在 ${agentName} 中检查后再决定`
  }
}

/** 只消费当前会话的文本、标题、配置及工具状态，外部内容始终作为文本处理。 */
export function applyAcpUpdate(
  session: Pick<NativeCodingSession, 'messages' | 'tools' | 'title' | 'options'>,
  raw: unknown,
  agentName = 'Agent'
): void {
  const update = acpObject(raw)
  if (!update) return
  const kind = update.sessionUpdate
  if (kind === 'agent_message_chunk' || kind === 'user_message_chunk') {
    const content = acpObject(update.content)
    if (content?.type !== 'text' || typeof content.text !== 'string') return
    const role = kind === 'user_message_chunk' ? 'user' : 'assistant'
    const total = session.messages.reduce((sum, message) => sum + message.content.length, 0)
    if (total + content.text.length > 200_000) throw new Error('会话内容达到显示上限，请新建会话')
    let last = session.messages.at(-1)
    if (!last || last.role !== role) {
      if (session.messages.length >= 200) throw new Error('会话消息达到显示上限，请新建会话')
      last = { id: `message-${session.messages.length + 1}`, role, content: '' }
      session.messages.push(last)
    }
    last.content += content.text
  } else if (kind === 'tool_call' || kind === 'tool_call_update') {
    const id = acpText(update.toolCallId, 200)
    if (!id) return
    const existing = session.tools.find((item) => item.id === id)
    const title = update.title
      ? acpPreview(update.title, agentName).slice(0, 500)
      : (existing?.title ?? '工具操作')
    const status = acpText(update.status, 40) || existing?.status || 'pending'
    if (existing) Object.assign(existing, { title, status })
    else {
      if (session.tools.length >= 100) session.tools.shift()
      session.tools.push({ id, title, status })
    }
  } else if (kind === 'session_info_update') {
    const title = acpText(update.title, 100).trim()
    if (title) session.title = title
  } else if (kind === 'config_option_update') session.options = acpOptions(update.configOptions)
  else if (kind === 'current_mode_update') {
    const mode = session.options.find((option) => option.category === 'mode')
    const value = acpText(update.currentModeId)
    if (mode?.options.some((option) => option.value === value)) mode.currentValue = value
  }
}
