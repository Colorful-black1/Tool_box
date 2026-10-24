import { MAX_PROMPT_BODY, promptVariables } from './prompt-tools'

/** 只保存可复用角色与固定模板定义；没有本次变量值或会话正文。 */
export interface AgentRolePreset {
  id: string
  name: string
  runtimeId: 'opencode' | 'codex'
  templateId: string
  templateTitle: string
  templateVersion: number
  body: string
}

/** 配置版本与模板版本分别记录，固定快照不随模板库后续编辑变化。 */
export interface AgentRoleLibrary {
  version: 1
  items: AgentRolePreset[]
}

/** 保留旧配置的白名单校验，不主动清理用户保存过的角色定义。 */
export function validateAgentRoles(raw: unknown): AgentRoleLibrary {
  const object = (value: unknown): Record<string, unknown> => {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new Error('角色预设格式无效')
    return value as Record<string, unknown>
  }
  const string = (value: unknown, max: number): string => {
    if (typeof value !== 'string' || !value.trim() || value.length > max)
      throw new Error('角色预设内容为空或超过上限')
    return value
  }
  const input = object(raw)
  if (input.version !== 1 || !Array.isArray(input.items) || input.items.length > 12)
    throw new Error('角色预设最多 12 项，且需使用当前配置版本')
  const ids = new Set<string>()
  let total = 0
  const items = input.items.map((raw): AgentRolePreset => {
    const item = object(raw)
    const id = string(item.id, 80)
    if (!/^[a-zA-Z0-9_-]+$/.test(id) || ids.has(id)) throw new Error('角色标识重复或无效')
    ids.add(id)
    if (item.runtimeId !== 'opencode' && item.runtimeId !== 'codex')
      throw new Error('角色运行时尚未接入')
    if (
      typeof item.templateVersion !== 'number' ||
      !Number.isSafeInteger(item.templateVersion) ||
      item.templateVersion < 0
    )
      throw new Error('角色模板版本无效')
    const body = string(item.body, MAX_PROMPT_BODY)
    promptVariables(body)
    total += body.length
    return {
      id,
      name: string(item.name, 60).trim(),
      runtimeId: item.runtimeId,
      templateId: string(item.templateId, 80),
      templateTitle: string(item.templateTitle, 60),
      templateVersion: item.templateVersion,
      body
    }
  })
  if (total > 60_000) throw new Error('角色模板总量最多 60,000 字符')
  return { version: 1, items }
}
