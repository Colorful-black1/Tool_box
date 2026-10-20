import { describe, expect, it } from 'vitest'

import type { NoteView } from '../../../../shared/types'
import type { ToolboxStore } from '../../chat-store/chat-store'
import type { ImportService } from '../../library/import-service'
import type { AgentToolContext } from '../tool-registry'
import { noteTools } from './notes'

const context: AgentToolContext = {
  conversationId: 'c1',
  notifyToolCall: () => undefined,
  notifyToolResult: () => undefined,
  requestApproval: async () => true
}

const notes: NoteView[] = [
  {
    id: 'n1',
    title: '读书笔记',
    content: '第一段。第二段提到星轨列车。第三段结束。',
    createdAtMs: 0,
    updatedAtMs: 100
  },
  {
    id: 'n2',
    title: '待办',
    content: '给妈妈打电话',
    createdAtMs: 0,
    updatedAtMs: 200
  }
]

function buildStore(): ToolboxStore {
  return { listNotes: () => notes } as unknown as ToolboxStore
}

function findTool(name: string) {
  const tool = noteTools({ store: buildStore(), importService: {} as ImportService }).find(
    (item) => item.name === name
  )
  if (!tool) throw new Error(`缺少工具 ${name}`)
  return tool
}

describe('noteTools.notes_search', () => {
  it('能搜到正文里的内容并返回片段', async () => {
    const tool = findTool('notes_search')
    const result = (await tool.handler({ query: '星轨列车' }, context)) as Array<{
      id: string
      snippet: string
    }>

    expect(tool.risk).toBe('read')
    expect(result).toHaveLength(1)
    expect(result[0]?.id).toBe('n1')
    expect(result[0]?.snippet).toContain('星轨列车')
  })

  it('空关键词直接报错，不返回全量笔记', async () => {
    const tool = findTool('notes_search')
    await expect(tool.handler({ query: '  ' }, context)).rejects.toThrow(/搜索关键词/)
  })

  it('搜不到时返回空数组', async () => {
    const tool = findTool('notes_search')
    await expect(tool.handler({ query: '不存在的词' }, context)).resolves.toEqual([])
  })
})
