import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openAppReference } from './open-app-reference'
import { useAppStore } from '../stores/app-store'
import { useTodoStore } from '../stores/todo-store'
import { useKnowledgeStore } from '../stores/knowledge-store'

const notes = vi.fn()
const todos = vi.fn()
beforeEach(() => {
  vi.clearAllMocks()
  useAppStore.setState({
    view: 'chat',
    hasUnsavedChanges: false,
    activeConversationId: 'c1',
    usageTarget: null,
    searchTarget: null
  })
  useKnowledgeStore.setState({ detail: null })
  vi.stubGlobal('window', { toolbox: { notes: { list: notes }, todos: { list: todos } } })
})
afterEach(() => vi.unstubAllGlobals())
describe('对话入口导航', () => {
  it('读取失败不会向界面泄露底层 SQL 或路径', async () => {
    notes.mockRejectedValueOnce(new Error('PRIVATE_SENTINEL SELECT raw FROM secret'))
    await expect(openAppReference('toolbox://open/note/n1')).rejects.toThrow('无法读取该结果')
  })
  it('失效笔记有提示，成功定位使用最新数据', async () => {
    notes.mockResolvedValueOnce([])
    await expect(openAppReference('toolbox://open/note/n1')).rejects.toThrow('已不存在')
    expect(useAppStore.getState().view).toBe('chat')
    notes.mockResolvedValueOnce([{ id: 'n1', title: '最新笔记', content: '正文' }])
    await openAppReference('toolbox://open/note/n1')
    expect(useAppStore.getState()).toMatchObject({
      view: 'notes',
      searchTarget: { kind: 'note', id: 'n1' }
    })
  })
  it('用户已切页面时旧查询不能抢回导航', async () => {
    let finish: (value: object[]) => void = () => undefined
    notes.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    const pending = openAppReference('toolbox://open/note/n1')
    useAppStore.getState().setView('tools')
    finish([{ id: 'n1' }])
    await pending
    expect(useAppStore.getState().view).toBe('tools')
  })
  it('待办定位保留编辑草稿，包含归档事项', async () => {
    const draft = {
      title: '尚未保存',
      details: '',
      priority: 'normal' as const,
      startAtMs: null,
      dueAtMs: null,
      remind: true
    }
    useTodoStore.setState({ draft, dirty: true })
    todos.mockResolvedValue({ items: [{ id: 't1' }], total: 1, notificationStatus: null })
    await openAppReference('toolbox://open/todo/t1')
    expect(useTodoStore.getState()).toMatchObject({ draft, dirty: true, focusId: 't1' })
    expect(useAppStore.getState().view).toBe('todos')
  })
  it('统计入口保留筛选，不传刷新或写入参数', async () => {
    await openAppReference('toolbox://open/usage?client=codex&from=2026-10-01&to=2026-10-25')
    expect(useAppStore.getState()).toMatchObject({
      view: 'agent-usage',
      usageTarget: { client: 'codex', from: '2026-10-01', to: '2026-10-25' }
    })
    await expect(openAppReference('toolbox://open/usage?refresh=true')).rejects.toThrow('无效')
  })
  it('知识库引用先取回分块再切页，失败不跳转', async () => {
    const document = {
      id: 'doc1',
      title: '部署说明',
      category: 'work',
      fileName: '部署说明.md',
      fileSize: 10,
      status: 'ready',
      chunkCount: 1,
      error: '',
      createdAtMs: 1,
      updatedAtMs: 2
    }
    const knowledge = {
      document: vi.fn(async () => ({
        document,
        sourcePath: 'C:\\资料\\部署说明.md',
        chunks: [],
        focusChunkId: 'chunk1'
      }))
    }
    vi.stubGlobal('window', { toolbox: { knowledge } })
    knowledge.document.mockRejectedValueOnce(new Error('资料不存在，请刷新列表'))
    await expect(openAppReference('toolbox://open/kb/doc1?chunk=chunk1')).rejects.toThrow(
      '无法读取该结果'
    )
    expect(useAppStore.getState().view).toBe('chat')

    await openAppReference('toolbox://open/kb/doc1?chunk=chunk1')
    expect(knowledge.document).toHaveBeenCalledWith('doc1', 'chunk1')
    expect(useKnowledgeStore.getState().detail?.focusChunkId).toBe('chunk1')
    expect(useAppStore.getState().view).toBe('kb')
  })
})
