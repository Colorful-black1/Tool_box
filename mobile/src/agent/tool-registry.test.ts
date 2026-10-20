import { describe, expect, it, vi } from 'vitest'

import type { MobileStore } from '../data/store'
import type { BookSummary, Bookmark, PasswordEntryView } from '../shared-bridge'
import {
  collectTools,
  filterToolsByPermission,
  optionalText,
  requireInt,
  requireText,
  runTool,
  toToolSchemas
} from './tool-registry'
import type { AgentToolContext, AgentToolDefinition } from './tool-registry'
import { noteTools } from './tools/notes'
import { passwordTools } from './tools/passwords'
import { groupTools } from './tools/groups'
import { bookmarkTools } from './tools/bookmarks'
import { bookTools } from './tools/books'

function makeContext(approved = true) {
  const calls: Array<{ callId: string; name: string; args: string }> = []
  const results: Array<{ callId: string; ok: boolean; summary: string }> = []
  const approvals: string[] = []
  const ctx: AgentToolContext = {
    conversationId: 'c1',
    notifyToolCall: (event) => calls.push(event),
    notifyToolResult: (event) => results.push(event),
    requestApproval: (event) => {
      approvals.push(event.callId)
      return Promise.resolve(approved)
    }
  }
  return { ctx, calls, results, approvals }
}

const readTool: AgentToolDefinition = {
  name: 'probe_read',
  description: '只读探针',
  parameters: { type: 'object', properties: {} },
  risk: 'read',
  handler: async () => ({ value: 1 })
}

const writeTool: AgentToolDefinition = {
  name: 'probe_write',
  description: '写入探针',
  parameters: { type: 'object', properties: {} },
  risk: 'write',
  handler: async () => ({ saved: true }),
  summarize: () => '已写入'
}

const boomTool: AgentToolDefinition = {
  name: 'probe_boom',
  description: '抛错探针',
  parameters: { type: 'object', properties: {} },
  risk: 'read',
  handler: async () => {
    throw new Error('后端炸了')
  }
}

describe('collectTools / filterToolsByPermission / toToolSchemas', () => {
  it('重名工具直接抛错', () => {
    expect(() => collectTools([[readTool], [readTool]])).toThrow(/重复的 Agent 工具名/)
  })

  it('只读档位只保留只读工具', () => {
    const all = [readTool, writeTool]
    expect(filterToolsByPermission(all, 'readonly').map((tool) => tool.name)).toEqual([
      'probe_read'
    ])
    expect(filterToolsByPermission(all, 'confirm')).toHaveLength(2)
    expect(filterToolsByPermission(all, 'full')).toHaveLength(2)
  })

  it('转成请求体的工具声明', () => {
    expect(toToolSchemas([readTool])).toEqual([
      {
        type: 'function',
        function: {
          name: 'probe_read',
          description: '只读探针',
          parameters: { type: 'object', properties: {} }
        }
      }
    ])
  })
})

describe('runTool', () => {
  it('只读工具直接执行，不问审批', async () => {
    const { ctx, calls, results, approvals } = makeContext()
    const output = await runTool({
      definition: readTool,
      callId: 'call_1',
      rawArguments: '{}',
      permission: 'confirm',
      ctx
    })

    expect(JSON.parse(output)).toEqual({ value: 1 })
    expect(calls).toEqual([{ callId: 'call_1', name: 'probe_read', args: '{}' }])
    expect(results[0]).toMatchObject({ ok: true })
    expect(approvals).toEqual([])
  })

  it('confirm 档位下写工具先请求批准，批准后执行', async () => {
    const { ctx, approvals, results } = makeContext(true)
    await runTool({
      definition: writeTool,
      callId: 'call_2',
      rawArguments: '{}',
      permission: 'confirm',
      ctx
    })

    expect(approvals).toEqual(['call_2'])
    expect(results[0]).toMatchObject({ ok: true, summary: '已写入' })
  })

  it('用户拒绝时不执行工具，并回给模型明确文案', async () => {
    const spy = vi.fn(writeTool.handler)
    const { ctx, results } = makeContext(false)
    const output = await runTool({
      definition: { ...writeTool, handler: spy },
      callId: 'call_3',
      rawArguments: '{}',
      permission: 'confirm',
      ctx
    })

    expect(spy).not.toHaveBeenCalled()
    expect(output).toContain('拒绝了该操作')
    expect(results[0]).toMatchObject({ ok: false, summary: '用户已拒绝该操作' })
  })

  it('full 档位下写工具不再问审批', async () => {
    const { ctx, approvals } = makeContext()
    await runTool({
      definition: writeTool,
      callId: 'call_4',
      rawArguments: '{}',
      permission: 'full',
      ctx
    })
    expect(approvals).toEqual([])
  })

  it('只读档位即使拿到写工具也不执行（第二道闸）', async () => {
    const spy = vi.fn(writeTool.handler)
    const { ctx, approvals } = makeContext()
    const output = await runTool({
      definition: { ...writeTool, handler: spy },
      callId: 'call_5',
      rawArguments: '{}',
      permission: 'readonly',
      ctx
    })

    expect(spy).not.toHaveBeenCalled()
    expect(approvals).toEqual([])
    expect(output).toContain('当前权限为只读')
  })

  it('handler 抛错时把可读信息回给模型，而不是让整轮崩掉', async () => {
    const { ctx, results } = makeContext()
    const output = await runTool({
      definition: boomTool,
      callId: 'call_6',
      rawArguments: '{}',
      permission: 'confirm',
      ctx
    })

    expect(output).toContain('后端炸了')
    expect(results[0]).toMatchObject({ ok: false, summary: '后端炸了' })
  })

  it('入参不是合法 JSON 时报可读错误', async () => {
    const { ctx, results } = makeContext()
    const output = await runTool({
      definition: readTool,
      callId: 'call_7',
      rawArguments: '{"broken":',
      permission: 'confirm',
      ctx
    })

    expect(output).toContain('不是合法 JSON')
    expect(results[0]).toMatchObject({ ok: false })
  })
})

describe('入参校验帮手', () => {
  it('requireText 拒绝空值与超长值', () => {
    expect(requireText({ note: '  标题 ' }, 'note', '笔记标题', 60)).toBe('标题')
    expect(() => requireText({}, 'note', '笔记标题', 60)).toThrow(/请提供笔记标题/)
    expect(() => requireText({ note: 'x'.repeat(5) }, 'note', '笔记标题', 3)).toThrow(/过长/)
  })

  it('requireInt 拒绝非整数与越界', () => {
    expect(requireInt({ idx: 2 }, 'idx', '章节序号', 0, 10)).toBe(2)
    expect(() => requireInt({ idx: 1.5 }, 'idx', '章节序号', 0, 10)).toThrow(/必须是整数/)
    expect(() => requireInt({ idx: 11 }, 'idx', '章节序号', 0, 10)).toThrow(/超出范围/)
  })

  it('optionalText 空串视为未提供', () => {
    expect(optionalText({ q: '' }, 'q', '关键词', 10)).toBeUndefined()
    expect(optionalText({ q: ' 三体 ' }, 'q', '关键词', 10)).toBe('三体')
  })
})

// ==================== 真实工具的行为（含安全边界） ====================

const passwordEntry: PasswordEntryView = {
  id: 'p1',
  title: 'GitHub',
  url: 'https://github.com',
  account: 'zhangsan@example.com',
  password: 'secret123',
  remark: '工作账号',
  firstLetter: 'G',
  isFavorite: false,
  isDecryptable: true,
  createdAtMs: 1,
  updatedAtMs: 2
}

function fakeStore(overrides: Partial<MobileStore>): MobileStore {
  return overrides as unknown as MobileStore
}

const fakeBook: BookSummary = {
  id: 'b1',
  title: '三体',
  author: '刘慈欣',
  chapterCount: 3,
  coverPath: '',
  sortIndex: 0,
  groupId: null,
  createdAtMs: 1,
  updatedAtMs: 1,
  progress: null
}

const fakeBookmark: Bookmark = {
  id: 'bm1',
  bookId: 'b1',
  chapterIdx: 2,
  pageIdx: 1,
  pageIdxRatio: 0.4,
  snippet: '片段',
  createdAtMs: 1
}

describe('passwords_list（手机端密码箱只读）', () => {
  it('账号脱敏、密码明文绝不进入工具返回值', async () => {
    const store = fakeStore({ listPasswords: async () => [passwordEntry] })
    const [listTool] = passwordTools({ store })
    const { ctx } = makeContext()

    const output = await runTool({
      definition: listTool,
      callId: 'call_8',
      rawArguments: '{}',
      permission: 'confirm',
      ctx
    })

    expect(output).not.toContain('secret123')
    expect(output).not.toContain('zhangsan@example.com')
    const parsed = JSON.parse(output) as Array<Record<string, unknown>>
    expect(parsed[0]).toMatchObject({
      title: 'GitHub',
      account: 'z******',
      hasPassword: true,
      isDecryptable: true
    })
  })

  it('手机端密码箱不提供「保存 / 覆盖」工具，只给收藏与删除', () => {
    const store = fakeStore({})
    const names = passwordTools({ store }).map((tool) => tool.name)
    // 保存会重新加密并覆盖原密文，isDecryptable === false 的条目会被毁掉
    expect(names).toEqual(['passwords_list', 'passwords_set_favorite', 'passwords_delete'])
    expect(names).not.toContain('passwords_save')
  })
})

describe('notes_save', () => {
  it('新建笔记不带 id，并要求标题与正文', async () => {
    const saveNote = vi.fn(async (input: { id?: string; title: string; content: string }) => ({
      id: 'n1',
      title: input.title,
      content: input.content,
      createdAtMs: 1,
      updatedAtMs: 1
    }))
    const store = fakeStore({ saveNote } as unknown as Partial<MobileStore>)
    const saveTool = noteTools({ store }).find((tool) => tool.name === 'notes_save')
    if (!saveTool) throw new Error('缺少 notes_save')

    const { ctx } = makeContext(true)
    const output = await runTool({
      definition: saveTool,
      callId: 'call_9',
      rawArguments: JSON.stringify({ title: '灵感', content: '买牛奶' }),
      permission: 'confirm',
      ctx
    })

    expect(saveNote).toHaveBeenCalledWith({ id: undefined, title: '灵感', content: '买牛奶' })
    expect(JSON.parse(output)).toMatchObject({ title: '灵感', updated: false })

    // 缺正文时直接报错，不落库
    const { ctx: ctx2 } = makeContext(true)
    const bad = await runTool({
      definition: saveTool,
      callId: 'call_10',
      rawArguments: JSON.stringify({ title: '灵感' }),
      permission: 'confirm',
      ctx: ctx2
    })
    expect(bad).toContain('请提供笔记正文')
  })
})

describe('手机端新增的工具', () => {
  it('passwords_set_favorite 只改收藏列，不触碰密文', async () => {
    const setPasswordFavorite = vi.fn(async () => undefined)
    const store = fakeStore({
      listPasswords: async () => [passwordEntry],
      setPasswordFavorite
    } as unknown as Partial<MobileStore>)
    const tool = passwordTools({ store }).find((item) => item.name === 'passwords_set_favorite')
    if (!tool) throw new Error('缺少 passwords_set_favorite')

    const { ctx } = makeContext(true)
    const output = await runTool({
      definition: tool,
      callId: 'call_20',
      rawArguments: JSON.stringify({ entry: 'GitHub', favorite: true }),
      permission: 'confirm',
      ctx
    })

    expect(setPasswordFavorite).toHaveBeenCalledWith('p1', true)
    expect(JSON.parse(output)).toMatchObject({ title: 'GitHub', isFavorite: true })
  })

  it('passwords_delete 删除指定条目', async () => {
    const deletePassword = vi.fn(async () => undefined)
    const store = fakeStore({
      listPasswords: async () => [passwordEntry],
      deletePassword
    } as unknown as Partial<MobileStore>)
    const tool = passwordTools({ store }).find((item) => item.name === 'passwords_delete')
    if (!tool) throw new Error('缺少 passwords_delete')

    const { ctx } = makeContext(true)
    await runTool({
      definition: tool,
      callId: 'call_21',
      rawArguments: JSON.stringify({ entry: 'GitHub' }),
      permission: 'confirm',
      ctx
    })

    expect(deletePassword).toHaveBeenCalledWith('p1')
  })

  it('notes_delete 删除指定笔记', async () => {
    const deleteNote = vi.fn(async () => undefined)
    const store = fakeStore({
      listNotes: async () => [
        { id: 'n1', title: '灵感', content: '买牛奶', createdAtMs: 1, updatedAtMs: 1 }
      ],
      deleteNote
    } as unknown as Partial<MobileStore>)
    const tool = noteTools({ store }).find((item) => item.name === 'notes_delete')
    if (!tool) throw new Error('缺少 notes_delete')

    const { ctx } = makeContext(true)
    await runTool({
      definition: tool,
      callId: 'call_22',
      rawArguments: JSON.stringify({ note: '灵感' }),
      permission: 'confirm',
      ctx
    })

    expect(deleteNote).toHaveBeenCalledWith('n1')
  })

  it('notes_search 能搜到正文并返回片段', async () => {
    const store = fakeStore({
      listNotes: async () => [
        {
          id: 'n1',
          title: '读书笔记',
          content: '第二段提到星轨列车',
          createdAtMs: 1,
          updatedAtMs: 1
        }
      ]
    } as unknown as Partial<MobileStore>)
    const tool = noteTools({ store }).find((item) => item.name === 'notes_search')
    if (!tool) throw new Error('缺少 notes_search')

    const { ctx } = makeContext()
    const output = await runTool({
      definition: tool,
      callId: 'call_23',
      rawArguments: JSON.stringify({ query: '星轨列车' }),
      permission: 'confirm',
      ctx
    })

    const parsed = JSON.parse(output) as Array<{ id: string; snippet: string }>
    expect(parsed[0]?.id).toBe('n1')
    expect(parsed[0]?.snippet).toContain('星轨列车')
  })

  it('groups_list 列出分组', async () => {
    const store = fakeStore({
      listGroups: async () => [{ id: 'g1', name: '科幻', sortIndex: 0 }]
    } as unknown as Partial<MobileStore>)
    const tool = groupTools({ store }).find((item) => item.name === 'groups_list')
    if (!tool) throw new Error('缺少 groups_list')

    const { ctx } = makeContext()
    const output = await runTool({
      definition: tool,
      callId: 'call_24',
      rawArguments: '{}',
      permission: 'confirm',
      ctx
    })

    expect(JSON.parse(output)).toEqual([{ id: 'g1', name: '科幻' }])
  })

  it('bookmarks_list 列出指定书籍的书签', async () => {
    const store = fakeStore({
      listBooks: async () => [fakeBook],
      listBookmarks: async () => [fakeBookmark]
    } as unknown as Partial<MobileStore>)
    const tool = bookmarkTools({ store }).find((item) => item.name === 'bookmarks_list')
    if (!tool) throw new Error('缺少 bookmarks_list')

    const { ctx } = makeContext()
    const output = await runTool({
      definition: tool,
      callId: 'call_25',
      rawArguments: JSON.stringify({ book: '三体' }),
      permission: 'confirm',
      ctx
    })

    const parsed = JSON.parse(output) as { book: { title: string }; bookmarks: unknown[] }
    expect(parsed.book.title).toBe('三体')
    expect(parsed.bookmarks).toHaveLength(1)
  })

  it('books_set_group 把书移入分组', async () => {
    const setBooksGroup = vi.fn(async () => undefined)
    const store = fakeStore({
      listBooks: async () => [fakeBook],
      listGroups: async () => [{ id: 'g1', name: '科幻', sortIndex: 0 }],
      setBooksGroup
    } as unknown as Partial<MobileStore>)
    const tool = bookTools({ store }).find((item) => item.name === 'books_set_group')
    if (!tool) throw new Error('缺少 books_set_group')

    const { ctx } = makeContext(true)
    await runTool({
      definition: tool,
      callId: 'call_26',
      rawArguments: JSON.stringify({ book: '三体', group: '科幻' }),
      permission: 'confirm',
      ctx
    })

    expect(setBooksGroup).toHaveBeenCalledWith(['b1'], 'g1')
  })
})
