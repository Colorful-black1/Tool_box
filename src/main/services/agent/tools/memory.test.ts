import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { memoryTools } from './memory'
import { ToolboxStore } from '../../chat-store/chat-store'
import { MemoryService } from '../../memory/memory-service'
import type { SecretBox } from '../../crypto/secret-box'
import type { AgentToolContext, AgentToolDefinition } from '../tool-registry'
import type { ImportService } from '../../library/import-service'

const box: SecretBox = {
  encrypt: (value) => JSON.stringify(value),
  decrypt: (value) => JSON.parse(value)
}

const ctx: AgentToolContext = {
  conversationId: 'conversation-1',
  sourceMessageId: 'message-1',
  notifyToolCall: () => undefined,
  notifyToolResult: () => undefined,
  requestApproval: async () => true
}

let root = ''
let store: ToolboxStore
let memory: MemoryService
let tools: AgentToolDefinition[]

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'toolbox-memory-tools-'))
  store = new ToolboxStore(join(root, 'toolbox.db'), box)
  memory = new MemoryService(store)
  tools = memoryTools({
    store,
    importService: {} as ImportService,
    memory
  })
})

afterEach(async () => {
  store.close()
  await rm(root, { recursive: true, force: true })
})

function tool(name: string): AgentToolDefinition {
  const found = tools.find((item) => item.name === name)
  if (!found) throw new Error(`missing tool ${name}`)
  return found
}

describe('长期记忆工具', () => {
  it('开启时暴露列表、检索、读取、记住与忘记五个工具', () => {
    expect(tools.map((item) => item.name)).toEqual([
      'memory_list',
      'memory_search',
      'memory_read',
      'memory_remember',
      'memory_forget'
    ])
    expect(tool('memory_remember').risk).toBe('write')
    expect(tool('memory_search').risk).toBe('read')
    expect(tool('memory_read').risk).toBe('read')
  })

  it('关闭总开关后不向模型暴露记忆工具', () => {
    store.configSet({ memoryEnabled: false })
    expect(memoryTools({ store, importService: {} as ImportService, memory })).toEqual([])
  })

  it('记住工具经审批后写入，并记录来源消息', async () => {
    const prepared = await tool('memory_remember').prepare?.(
      {
        kind: 'constraint',
        title: '不要自动提交',
        body: '没有明确指令时不要执行 git commit。',
        tags: ['git']
      },
      ctx
    )
    expect(prepared?.args).toContain('记住一条约束记忆')
    const result = (await prepared?.execute()) as { id: string; title: string }

    expect(result.title).toBe('不要自动提交')
    expect(memory.get(result.id)).toMatchObject({
      status: 'active',
      sourceConversationId: 'conversation-1',
      sourceMessageId: 'message-1'
    })
  })

  it('检索返回摘要，读取返回完整正文与来源', async () => {
    const item = memory.save(
      {
        kind: 'procedural',
        title: '发布流程',
        body: '发布前先执行构建、类型检查和测试。',
        tags: ['发布'],
        pinned: false
      },
      { conversationId: 'conversation-1', messageId: 'message-1', excerpt: '以后发布都先跑检查' }
    )

    const searched = (await tool('memory_search').handler({ query: '构建' }, ctx)) as {
      count: number
      items: Array<{ id: string; body: string }>
    }
    expect(searched.count).toBe(1)
    expect(searched.items[0].id).toBe(item.id)

    const read = (await tool('memory_read').handler({ id: item.id }, ctx)) as {
      body: string
      source: { excerpt: string }
    }
    expect(read.body).toContain('类型检查')
    expect(read.source.excerpt).toBe('以后发布都先跑检查')
  })

  it('忘记工具按 ID 归档，不物理删除', async () => {
    const item = memory.save({
      kind: 'preference',
      title: '先给结论',
      body: '回答先给结论。',
      tags: [],
      pinned: true
    })
    const prepared = await tool('memory_forget').prepare?.({ id: item.id }, ctx)
    expect(prepared?.args).toContain('归档长期记忆「先给结论」')
    await prepared?.execute()

    expect(memory.get(item.id).status).toBe('archived')
    expect(memory.list().total).toBe(1)
  })

  it('直接调用写工具 handler 会被拒绝，必须走审批入口', async () => {
    await expect(
      tool('memory_remember').handler(
        { kind: 'preference', title: '先给结论', body: '回答先给结论。' },
        ctx
      )
    ).rejects.toThrow('请通过审批入口保存记忆')
  })
})
