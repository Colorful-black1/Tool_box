/**
 * Agent 权限档位的读写。
 *
 * 与桌面端共用同一套常量与**同一个 kv 键**（`read_config` 里的 `agentPermission`），
 * 默认值也一致（写操作确认）。两端数据库虽然独立，但语义与键名刻意对齐，
 * 避免日后做跨端迁移时两边对不上。
 *
 * 存储位置选择 `configGet/configSet`（kv 表的 read_config JSON）而不是新表：
 * 这样**不需要改 schema**，升级不用迁移、也不用重新生成 desktop-schema.fixture.json。
 */
import type { AgentPermission } from '../shared-bridge'
import { DEFAULT_AGENT_PERMISSION, isAgentPermission } from '../shared-bridge'
import type { MobileStore } from '../data/store'

export async function getAgentPermission(store: MobileStore): Promise<AgentPermission> {
  const config = await store.configGet()
  const value = config?.['agentPermission']
  return isAgentPermission(value) ? value : DEFAULT_AGENT_PERMISSION
}

export async function setAgentPermission(
  store: MobileStore,
  permission: AgentPermission
): Promise<AgentPermission> {
  await store.configSet({ agentPermission: permission })
  return permission
}
