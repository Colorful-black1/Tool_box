import { describe, expect, it, vi } from 'vitest'
import { workspaceTools } from './workspace'
import type { AgentDeps } from './deps'
import type { AgentToolContext } from '../tool-registry'

const ctx: AgentToolContext = {
  conversationId: 'c1',
  notifyToolCall: () => undefined,
  notifyToolResult: () => undefined,
  requestApproval: async () => true
}
function tools() {
  const deps = {
    store: {
      listNotes: () => [{ id: 'n1', title: '发布笔记', content: '检查数据库', updatedAtMs: 1 }],
      listBooks: () => [{ id: 'b1', title: '发布故事', author: '测试', chapterCount: 2 }],
      listGroups: () => [{ id: 'g1', name: '发布资料' }],
      listChapters: () => [{ idx: 0, title: '第一章' }],
      listPasswords: vi.fn(() => {
        throw new Error('禁止读取密码箱')
      })
    },
    todos: {
      list: ({ filter }: { filter: string }) => ({
        total: 1,
        items: [
          {
            id: filter,
            title: '发布检查',
            details: '检查项',
            completedAtMs: filter === 'completed' ? 1 : null,
            archivedAtMs: filter === 'archived' ? 1 : null
          }
        ]
      })
    }
  } as unknown as AgentDeps
  return { search: workspaceTools(deps)[0], open: workspaceTools(deps)[1], deps }
}
describe('对话跨域搜索与打开', () => {
  it('返回四类来源、完成和归档状态及受限结果，不访问密码箱', async () => {
    const { search, deps } = tools()
    const result = await search.handler({ query: '发布' }, ctx)
    expect(result).toMatchObject({
      results: [
        { domain: 'notes', total: 1 },
        { domain: 'todos', total: 3 },
        { domain: 'books', total: 1 },
        { domain: 'groups', total: 1 }
      ]
    })
    expect(search.references!({}, result)).toHaveLength(6)
    expect(deps.store.listPasswords).not.toHaveBeenCalled()
  })
  it('限制域和结果，空关键词与非法域拒绝', async () => {
    const { search } = tools()
    const result = await search.handler(
      { query: '检查', domains: ['notes'], limitPerDomain: 1 },
      ctx
    )
    expect(result).toMatchObject({ results: [{ domain: 'notes', total: 1 }] })
    for (const input of [{ query: ' ' }, { query: 'a', domains: ['passwords'] }])
      await expect(search.handler(input, ctx)).rejects.toThrow()
  })
  it('准确验证章节存在，不把打开当作写入', async () => {
    const { open } = tools()
    expect(await open.handler({ kind: 'book', ref: 'b1', chapterIdx: 0 }, ctx)).toMatchObject({
      target: { kind: 'chapter', id: 'b1', chapterIdx: 0 }
    })
    await expect(open.handler({ kind: 'book', ref: 'b1', chapterIdx: 5 }, ctx)).rejects.toThrow(
      '章节不存在'
    )
    await expect(open.handler({ kind: 'note', ref: 'n1', chapterIdx: 0 }, ctx)).rejects.toThrow(
      '只有书籍'
    )
  })
})
