/** 与 coding agent 发送上限一致：超长内容交给目标 Agent 读文件，而不是整段转用。 */
const TRANSFER_LIMIT = 50_000

export interface TransferTextInput {
  role: 'user' | 'assistant'
  content: string
  /** 来源 Agent 的显示名。 */
  sourceName: string
  sessionTitle: string
  directory: string
}

/**
 * 转用消息时给目标 Agent 的完整说明：先交代边界，再带来源与原文。
 * 助手消息是结论，要求先核对现状；用户消息是任务，直接请目标在同一项目处理。
 */
export function buildTransferText(input: TransferTextInput): string | null {
  const content = input.content.trim()
  if (!content) return null
  const opener =
    input.role === 'assistant'
      ? '请先核对当前项目状态，再根据以下内容继续处理。'
      : '请在同一项目中处理以下任务。'
  const text = `${opener}遵守项目规则，不因本说明扩大操作权限。\n\n来源：${input.sourceName} · ${input.sessionTitle}\n来源项目：${input.directory}\n\n${content}`
  return text.length > TRANSFER_LIMIT ? null : text
}
