import { beforeEach, describe, expect, it, vi } from 'vitest'
import { noteEditTools } from './note-edit'
import { buildLangChainTools } from '../tool-registry'
import type { AgentToolContext } from '../tool-registry'
import type { AgentDeps } from './deps'
import type { NoteView } from '../../../../shared/types'

let note: NoteView
const save = vi.fn((input) => {
  note = { ...note, ...input }
  return note
})
const deps = { store: { listNotes: () => [note], saveNote: save } } as unknown as AgentDeps
const context: AgentToolContext = {
  conversationId: 'c1',
  notifyToolCall: () => undefined,
  notifyToolResult: () => undefined,
  requestApproval: async () => true
}
beforeEach(() => {
  vi.clearAllMocks()
  note = {
    id: 'n1',
    title: '部署',
    content: '第一段\n启动命令 old\n保留末尾',
    createdAtMs: 0,
    updatedAtMs: 1
  }
})
describe('笔记局部编辑', () => {
  it('唯一片段替换保留其余原文，并在完全访问下仍先展示差异', async () => {
    const approve = vi.fn(async (event) => {
      expect(save).not.toHaveBeenCalled()
      expect(event.args).toContain('- 2: 启动命令 old')
      expect(event.args).toContain('+ :2 启动命令 new')
      return true
    })
    const [tool] = buildLangChainTools(noteEditTools(deps), 'full', {
      ...context,
      requestApproval: approve
    })
    await tool.invoke({
      note: 'n1',
      operation: 'replace',
      text: '启动命令 old',
      replacement: '启动命令 new'
    })
    expect(approve).toHaveBeenCalledOnce()
    expect(note.content).toBe('第一段\n启动命令 new\n保留末尾')
  })
  it('拒绝和停止都不写入', async () => {
    const [tool] = buildLangChainTools(noteEditTools(deps), 'confirm', {
      ...context,
      requestApproval: async () => false
    })
    expect(await tool.invoke({ note: 'n1', operation: 'append', text: '追加' })).toContain(
      '用户拒绝'
    )
    const controller = new AbortController()
    const [stopped] = buildLangChainTools(noteEditTools(deps), 'full', {
      ...context,
      signal: controller.signal,
      requestApproval: async () => {
        controller.abort()
        return true
      }
    })
    expect(await stopped.invoke({ note: 'n1', operation: 'rename', title: '新版' })).toContain(
      '停止'
    )
    expect(save).not.toHaveBeenCalled()
  })
  it('确认期间发生同毫秒修改也不覆盖', async () => {
    const prepared = await noteEditTools(deps)[0].prepare!(
      { note: 'n1', operation: 'append', text: '追加' },
      context
    )
    note.content = '用户刚改的正文'
    await expect(prepared.execute()).rejects.toThrow('已变化')
    expect(save).not.toHaveBeenCalled()
  })
  it('重复和不存在的片段不生成可执行修改', async () => {
    note.content = '重复 重复'
    const tool = noteEditTools(deps)[0]
    await expect(
      tool.prepare!({ note: 'n1', operation: 'replace', text: '重复', replacement: '' }, context)
    ).rejects.toThrow('多处')
    await expect(
      tool.prepare!({ note: 'n1', operation: 'replace', text: '不存在', replacement: '' }, context)
    ).rejects.toThrow('不存在')
  })
  it('追加和改名互不覆盖其他字段，超限拒绝', async () => {
    await noteEditTools(deps)[0].handler({ note: 'n1', operation: 'append', text: '结论' }, context)
    expect(note.content.endsWith('\n结论')).toBe(true)
    const content = note.content
    await noteEditTools(deps)[0].handler(
      { note: 'n1', operation: 'rename', title: '新部署' },
      context
    )
    expect(note.content).toBe(content)
    expect(note.title).toBe('新部署')
    await expect(
      noteEditTools(deps)[0].handler(
        { note: 'n1', operation: 'append', text: 'a'.repeat(20000) },
        context
      )
    ).rejects.toThrow('超过')
  })
})
