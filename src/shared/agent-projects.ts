import type { CodingAgentId } from './coding-agents'

/** 运行时标识与既有配置键不同；Desktop 的旧别名只用于兼容读取。 */
export const AGENT_CONFIG_KEYS: Record<CodingAgentId, string> = {
  opencode: 'opencode',
  codex: 'codex',
  kimi: 'kimi',
  claude: 'claude',
  'claude-desktop': 'claudeDesktop',
  dsh: 'dsh'
}

/** 合并 Desktop 旧别名，规范键优先；不丢失程序路径、扩展或历史偏好。 */
export function agentPreferences(
  config: Record<string, unknown> | null | undefined,
  id: CodingAgentId
): Record<string, unknown> {
  const object = (value: unknown): Record<string, unknown> =>
    value !== null && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {}
  return {
    ...(id === 'claude-desktop' ? object(config?.['claude-desktop']) : {}),
    ...object(config?.[AGENT_CONFIG_KEYS[id]])
  }
}

/** 已校验的运行时补丁按字段合并，防止只更新目录时清掉其他偏好。 */
export function mergeAgentPreferences(
  config: Record<string, unknown> | null,
  patch: Record<string, unknown>
): Record<string, unknown> {
  const merged = { ...patch }
  for (const [id, key] of Object.entries(AGENT_CONFIG_KEYS)) {
    if (Object.hasOwn(patch, key))
      merged[key] = {
        ...agentPreferences(config, id as CodingAgentId),
        ...(patch[key] as Record<string, unknown>)
      }
  }
  return merged
}
