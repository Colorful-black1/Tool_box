import { describe, expect, it } from 'vitest'

import type { PasswordEntryView } from '../../../../shared/types'
import type { ToolboxStore } from '../../chat-store/chat-store'
import type { ImportService } from '../../library/import-service'
import type { AgentToolContext } from '../tool-registry'
import { passwordTools } from './passwords'

const context: AgentToolContext = {
  conversationId: 'c1',
  notifyToolCall: () => undefined,
  notifyToolResult: () => undefined,
  requestApproval: async () => true
}

const entry: PasswordEntryView = {
  id: 'p1',
  title: 'GitHub',
  url: 'https://github.com',
  account: 'alice@example.com',
  password: 's3cr3t-pw',
  remark: '私密备注',
  firstLetter: 'G',
  isFavorite: true,
  isDecryptable: true,
  createdAtMs: 0,
  updatedAtMs: 0
}

function buildStore(entries: PasswordEntryView[]): ToolboxStore {
  return { listPasswords: () => entries } as unknown as ToolboxStore
}

const deps = {
  store: buildStore([entry]),
  importService: {} as ImportService
}

describe('passwordTools.passwords_list', () => {
  it('绝不返回明文密码、完整账号或备注', async () => {
    const [listTool] = passwordTools(deps)
    const result = await listTool.handler({}, context)
    const serialized = JSON.stringify(result)

    expect(serialized).not.toContain('s3cr3t-pw')
    expect(serialized).not.toContain('alice@example.com')
    expect(serialized).not.toContain('私密备注')
    expect(listTool.risk).toBe('read')
  })

  it('支持按名称关键词过滤', async () => {
    const [listTool] = passwordTools(deps)
    const hit = (await listTool.handler({ query: 'git' }, context)) as unknown[]
    const miss = (await listTool.handler({ query: 'not-exist' }, context)) as unknown[]
    expect(hit).toHaveLength(1)
    expect(miss).toHaveLength(0)
  })
})
