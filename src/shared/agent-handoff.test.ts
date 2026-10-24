import { describe, expect, it } from 'vitest'
import { validateAgentRoles } from './agent-handoff'
import type { AgentRolePreset } from './agent-handoff'
const role: AgentRolePreset = {
  id: 'review',
  name: '审查者',
  runtimeId: 'codex',
  templateId: 'review-template',
  templateTitle: '审查模板',
  templateVersion: 3,
  body: '按 {{focus}} 审查以下内容：\n{{context}}'
}

describe('历史角色配置兼容', () => {
  it('只保存模板定义的白名单字段，拒绝重复、未知运行时与超量配置', () => {
    const result = validateAgentRoles({
      version: 1,
      items: [
        { ...role, values: { focus: '本次私有变量' }, context: '本次正文', credentials: 'private' }
      ]
    })
    expect(result).toEqual({ version: 1, items: [role] })
    expect(() => validateAgentRoles({ version: 1, items: [role, role] })).toThrow('重复')
    expect(() =>
      validateAgentRoles({ version: 1, items: [{ ...role, runtimeId: 'kimi' }] })
    ).toThrow('尚未接入')
    expect(() => validateAgentRoles({ version: 1, items: Array(13).fill(role) })).toThrow('12 项')
    expect(() =>
      validateAgentRoles({ version: 1, items: [{ ...role, body: 'x'.repeat(12_001) }] })
    ).toThrow('上限')
    expect(() =>
      validateAgentRoles({
        version: 1,
        items: Array.from({ length: 6 }, (_, i) => ({
          ...role,
          id: `role-${i}`,
          body: 'x'.repeat(12_000)
        }))
      })
    ).toThrow('60,000')
  })
})
