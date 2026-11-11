import { create } from 'zustand'

import type {
  AgentPermission,
  AgentToolApprovalRequestEvent,
  AgentToolCallEvent,
  AgentToolResultEvent,
  AgentToolRisk,
  AiConfigView,
  AiFetchModelsInput,
  AiModelListResult,
  AiProfileInput,
  AiProfileView,
  AppInfo,
  BookGroup,
  BookSummary,
  ChatCompactResult,
  ChatCompactionEvent,
  ChatCompletedEvent,
  ChatContextEvent,
  ChatContextView,
  ChatDeltaEvent,
  ChatErrorEvent,
  ChatMessage,
  ChatStoppedEvent,
  ConversationSummary,
  NoteSaveInput,
  NoteView,
  PasswordDraft,
  PasswordEntryView,
  PasswordInput,
  StatsSummary
} from '../../../shared/types'
import { DEFAULT_AGENT_PERMISSION, findAiProvider } from '../../../shared/types'
import { resolveChatModels } from '../../../shared/model-list'
import type { UsageQuery } from '../../../shared/agent-usage'

export type AppView =
  | 'commands'
  | 'agent-usage'
  | 'opencode'
  | 'chat'
  | 'shelf'
  | 'reading'
  | 'stats'
  | 'passwords'
  | 'notes'
  | 'todos'
  | 'kb'
  | 'tools'
  | 'settings'

/** 全局搜索的一次性定位请求，仅用于渲染层导航，不落盘。 */
export interface SearchTarget {
  kind: 'note' | 'password' | 'group'
  id: string
}

interface StreamingState {
  conversationId: string
  content: string
}

/** Agent 工具调用在界面上的呈现状态 */
export interface ToolCallView {
  callId: string
  name: string
  args: string
  status: 'running' | 'ok' | 'error'
  summary?: string
}

/** 待用户批准的写 / 破坏性工具调用 */
export interface PendingApprovalView {
  conversationId: string
  callId: string
  name: string
  args: string
  risk: AgentToolRisk
}

interface AppState {
  bootstrapped: boolean
  loading: boolean
  view: AppView
  /** 工具页当前选中的工具 id */
  toolsActiveId: string | null
  searchTarget: SearchTarget | null
  usageTarget: UsageQuery | null
  readerStartChapter: number | null
  hasUnsavedChanges: boolean
  error: string | null
  appInfo: AppInfo | null

  settings: AiConfigView | null
  conversations: ConversationSummary[]
  activeConversationId: string | null
  /** 用户手动从工具填入的内容也留在草稿，发送仍由对话页触发。 */
  chatDraft: string
  messages: ChatMessage[]
  /** 当前会话的上下文占用 / 检查点；切换会话后重新读取 */
  context: ChatContextView | null
  /** 自动或手动压缩进行中 */
  compacting: boolean
  streaming: StreamingState | null
  /**
   * AI 的工具调用记录。
   *
   * **界面不展示**：查书架、读分组这类是后台动作，摆出来只会让人以为出了错
   * （见 `chat-panel.tsx` 的说明）。这里仍然记着，是给「查看 AI 操作记录」这类
   * 排查场景留的底子，真要用时不必再改主进程与 IPC。
   */
  toolCalls: ToolCallView[]
  pendingApproval: PendingApprovalView | null
  agentPermission: AgentPermission
  /** 对话页模型下拉的可选模型（当前模型 + 用户勾选的清单） */
  chatModels: string[]

  books: BookSummary[]
  groups: BookGroup[]
  activeBookId: string | null

  passwords: PasswordEntryView[]
  notes: NoteView[]
  stats: StatsSummary | null

  bootstrap(): Promise<void>
  setView(view: AppView): void
  /** 工具页当前选中的工具 id（切走再切回来仍是同一个） */
  setToolsActive(toolId: string): void
  openSearchTarget(target: SearchTarget): void
  clearSearchTarget(): void
  setUnsavedChanges(dirty: boolean): void
  clearError(): void

  // AI 对话
  refreshConversations(): Promise<void>
  selectConversation(id: string): Promise<void>
  createConversation(): Promise<void>
  renameConversation(id: string, title: string): Promise<void>
  deleteConversation(id: string): Promise<void>
  sendMessage(content: string): Promise<void>
  setChatDraft(content: string): void
  stopGeneration(): Promise<void>
  appendDelta(event: ChatDeltaEvent): void
  completeChat(event: ChatCompletedEvent): void
  failChat(event: ChatErrorEvent): void
  stopChat(event: ChatStoppedEvent): void

  // 上下文
  refreshContext(): Promise<void>
  compactContext(): Promise<ChatCompactResult | null>
  receiveContext(event: ChatContextEvent): void
  receiveCompaction(event: ChatCompactionEvent): void

  // AI 助手 Agent
  loadAgentPermission(): Promise<void>
  setAgentPermission(permission: AgentPermission): Promise<void>
  appendToolCall(event: AgentToolCallEvent): void
  completeToolResult(event: AgentToolResultEvent): void
  requestToolApproval(event: AgentToolApprovalRequestEvent): void
  respondToolApproval(approved: boolean): Promise<void>

  // 书架
  refreshBooks(): Promise<void>
  refreshGroups(): Promise<void>
  importBook(): Promise<void>
  openReader(bookId: string, chapterIdx?: number): void
  closeReader(): void
  deleteBook(bookId: string): Promise<void>
  reorderBooks(ids: string[]): Promise<void>
  updateBookMeta(
    id: string,
    meta: { title?: string; author?: string }
  ): Promise<void>
  setCover(bookId: string): Promise<void>
  setBooksGroup(ids: string[], groupId: string | null): Promise<void>
  createGroup(name: string): Promise<BookGroup>
  renameGroup(id: string, name: string): Promise<void>
  deleteGroup(id: string): Promise<void>

  // 密码箱
  refreshPasswords(): Promise<void>
  savePasswordEntry(input: PasswordInput & { id?: string }): Promise<void>
  deletePasswordEntry(id: string): Promise<void>
  togglePasswordFavorite(id: string, isFavorite: boolean): Promise<void>
  savePasswordDrafts(drafts: PasswordDraft[]): Promise<number>

  // 记事本
  refreshNotes(): Promise<void>
  saveNote(input: NoteSaveInput): Promise<NoteView>
  deleteNote(id: string): Promise<void>
  importNote(): Promise<NoteView | null>
  exportNote(id: string): Promise<string | null>

  // 统计
  refreshStats(): Promise<void>

  // 设置
  saveProfile(input: AiProfileInput): Promise<AiConfigView>
  removeProfile(id: string): Promise<AiConfigView>
  activateProfile(id: string): Promise<AiConfigView>
  fetchModels(input: AiFetchModelsInput): Promise<AiModelListResult>
  copyText(text: string): Promise<void>

  // 对话侧模型下拉
  loadChatModels(): Promise<void>
  selectModel(model: string): Promise<void>
}

export const useAppStore = create<AppState>((set, get) => ({
  bootstrapped: false,
  loading: true,
  view: 'chat',
  toolsActiveId: null,
  searchTarget: null,
  usageTarget: null,
  readerStartChapter: null,
  hasUnsavedChanges: false,
  error: null,
  appInfo: null,
  settings: null,
  conversations: [],
  activeConversationId: null,
  chatDraft: '',
  messages: [],
  context: null,
  compacting: false,
  streaming: null,
  toolCalls: [],
  pendingApproval: null,
  agentPermission: DEFAULT_AGENT_PERMISSION,
  chatModels: [],
  books: [],
  groups: [],
  activeBookId: null,
  passwords: [],
  notes: [],
  stats: null,

  bootstrap: async () => {
    if (get().bootstrapped) return
    if (!window.toolbox) {
      set({
        loading: false,
        error: '本地桥接未就绪：请通过桌面应用窗口运行（npm run dev）'
      })
      return
    }
    set({ loading: true })

    try {
      const bridge = window.toolbox
      const [settings, existing, books, groups, passwords, notes, appInfo] =
        await Promise.all([
          bridge.settings.get(),
          bridge.chat.listConversations(),
          bridge.books.list(),
          bridge.groups.list(),
          bridge.passwords.list(),
          bridge.notes.list(),
          bridge.app.info()
        ])

      let conversations = existing
      if (conversations.length === 0) {
        conversations = [await bridge.chat.createConversation()]
      }
      const activeConversationId = conversations[0]?.id ?? null
      const messages = activeConversationId
        ? await bridge.chat.listMessages(activeConversationId)
        : []
      const context = activeConversationId
        ? await bridge.chat.context(activeConversationId)
        : null

      set({
        bootstrapped: true,
        loading: false,
        settings,
        conversations,
        activeConversationId,
        messages,
        context,
        books,
        groups,
        passwords,
        notes,
        appInfo
      })
      void get().loadChatModels()
    } catch (error) {
      set({ loading: false, error: toErrorMessage(error) })
    }
  },

  setView: (view) => set({ view, searchTarget: null, usageTarget: null }),
  setToolsActive: (toolId) => set({ toolsActiveId: toolId }),
  openSearchTarget: (target) =>
    set({
      view: target.kind === 'note' ? 'notes' : target.kind === 'password' ? 'passwords' : 'shelf',
      searchTarget: target
    }),
  clearSearchTarget: () => set({ searchTarget: null }),
  setUnsavedChanges: (dirty) => set({ hasUnsavedChanges: dirty }),
  clearError: () => set({ error: null }),

  // ---------- AI 对话 ----------
  setChatDraft: (content) => set({ chatDraft: content }),
  refreshConversations: async () => {
    const conversations = await window.toolbox.chat.listConversations()
    set({ conversations })
  },

  selectConversation: async (id) => {
    if (get().activeConversationId === id) return
    set({
      activeConversationId: id,
      messages: [],
      context: null,
      compacting: false,
      error: null
    })
    const [messages, context] = await Promise.all([
      window.toolbox.chat.listMessages(id),
      window.toolbox.chat.context(id)
    ])
    if (get().activeConversationId === id) set({ messages, context })
  },

  createConversation: async () => {
    const conversation = await window.toolbox.chat.createConversation()
    set((state) => ({
      conversations: [conversation, ...state.conversations],
      activeConversationId: conversation.id,
      messages: [],
      context: null,
      compacting: false,
      error: null
    }))
    void get().refreshContext()
  },

  renameConversation: async (id, title) => {
    const conversation = await window.toolbox.chat.renameConversation(id, title)
    set((state) => ({
      conversations: upsertConversation(state.conversations, conversation)
    }))
  },

  deleteConversation: async (id) => {
    await window.toolbox.chat.deleteConversation(id)
    const remaining = get().conversations.filter((item) => item.id !== id)
    if (get().activeConversationId !== id) {
      set({ conversations: remaining })
      return
    }
    if (remaining.length > 0) {
      const messages = await window.toolbox.chat.listMessages(remaining[0].id)
      set({
        conversations: remaining,
        activeConversationId: remaining[0].id,
        messages,
        context: null,
        compacting: false
      })
      void get().refreshContext()
      return
    }
    const conversation = await window.toolbox.chat.createConversation()
    set({
      conversations: [conversation],
      activeConversationId: conversation.id,
      messages: [],
      context: null,
      compacting: false
    })
    void get().refreshContext()
  },

  sendMessage: async (content) => {
    const { activeConversationId, streaming } = get()
    if (!activeConversationId || streaming) return
    set({ error: null })
    try {
      const result = await window.toolbox.chat.send({
        conversationId: activeConversationId,
        content
      })
      set((state) => ({
        messages: [...state.messages, result.userMessage],
        conversations: upsertConversation(state.conversations, result.conversation),
        streaming: { conversationId: activeConversationId, content: '' },
        toolCalls: [],
        pendingApproval: null
      }))
    } catch (error) {
      // 输入框在提交时已清空；发送失败要把原文还回去，避免配置未就绪或网络失败后重打长文。
      // 用户若已在等待期间输入新内容，保留新内容。
      set((state) => ({
        error: toErrorMessage(error),
        chatDraft: state.chatDraft.trim() ? state.chatDraft : content
      }))
    }
  },

  stopGeneration: async () => {
    const { activeConversationId } = get()
    if (!activeConversationId) return
    await window.toolbox.chat.stop(activeConversationId)
  },

  appendDelta: (event) =>
    set((state) => {
      if (state.streaming?.conversationId !== event.conversationId) return state
      return {
        streaming: {
          conversationId: event.conversationId,
          content: state.streaming.content + event.delta
        }
      }
    }),

  completeChat: (event) =>
    set((state) => ({
      conversations: upsertConversation(state.conversations, event.conversation),
      messages:
        event.conversationId === state.activeConversationId
          ? [...state.messages, event.message]
          : state.messages,
      streaming:
        state.streaming?.conversationId === event.conversationId
          ? null
          : state.streaming,
      pendingApproval:
        state.pendingApproval?.conversationId === event.conversationId
          ? null
          : state.pendingApproval
    })),

  failChat: (event) =>
    set((state) => ({
      error:
        event.conversationId === state.activeConversationId
          ? event.message
          : state.error,
      streaming:
        state.streaming?.conversationId === event.conversationId
          ? null
          : state.streaming,
      pendingApproval:
        state.pendingApproval?.conversationId === event.conversationId
          ? null
          : state.pendingApproval
    })),

  stopChat: (event) =>
    set((state) => ({
      streaming:
        state.streaming?.conversationId === event.conversationId
          ? null
          : state.streaming,
      pendingApproval:
        state.pendingApproval?.conversationId === event.conversationId
          ? null
          : state.pendingApproval
    })),

  // ---------- 上下文 ----------
  refreshContext: async () => {
    const id = get().activeConversationId
    if (!id || !window.toolbox?.chat) return
    try {
      const context = await window.toolbox.chat.context(id)
      if (get().activeConversationId === id) {
        set({ context, compacting: context.compacting })
      }
    } catch {
      // 上下文只是辅助信息，读取失败不覆盖对话本身的错误
    }
  },

  compactContext: async () => {
    const id = get().activeConversationId
    if (!id || get().compacting) return null
    set({ compacting: true, error: null })
    try {
      const result = await window.toolbox.chat.compact(id)
      if (result.message && !result.compacted) set({ error: result.message })
      await get().refreshContext()
      return result
    } catch (error) {
      set({ error: toErrorMessage(error) })
      return null
    } finally {
      set({ compacting: false })
    }
  },

  receiveContext: (event) => {
    if (event.conversationId !== get().activeConversationId) return
    set({ context: event.context, compacting: event.context.compacting })
  },

  receiveCompaction: (event) => {
    if (event.conversationId !== get().activeConversationId) return
    if (event.phase === 'started') {
      set({ compacting: true })
      return
    }
    set({
      compacting: false,
      ...(event.phase === 'failed' && event.message ? { error: event.message } : {})
    })
  },

  // ---------- AI 助手 Agent ----------
  loadAgentPermission: async () => {
    if (!window.toolbox?.agent) return
    const permission = await window.toolbox.agent.getPermission()
    set({ agentPermission: permission })
  },

  setAgentPermission: async (permission) => {
    set({ agentPermission: permission })
    if (!window.toolbox?.agent) return
    const saved = await window.toolbox.agent.setPermission(permission)
    set({ agentPermission: saved })
  },

  appendToolCall: (event) =>
    set((state) => {
      if (state.streaming?.conversationId !== event.conversationId) return state
      return {
        toolCalls: [
          ...state.toolCalls,
          { callId: event.callId, name: event.name, args: event.args, status: 'running' }
        ]
      }
    }),

  completeToolResult: (event) =>
    set((state) => {
      if (state.streaming?.conversationId !== event.conversationId) return state
      return {
        toolCalls: state.toolCalls.map((call) =>
          call.callId === event.callId
            ? { ...call, status: event.ok ? 'ok' : 'error', summary: event.summary }
            : call
        )
      }
    }),

  requestToolApproval: (event) =>
    set({
      pendingApproval: {
        conversationId: event.conversationId,
        callId: event.callId,
        name: event.name,
        args: event.args,
        risk: event.risk
      }
    }),

  respondToolApproval: async (approved) => {
    const pending = get().pendingApproval
    set({ pendingApproval: null })
    if (!pending) return
    await window.toolbox.chat.approveTool({
      conversationId: pending.conversationId,
      callId: pending.callId,
      approved
    })
  },

  // ---------- 书架 ----------
  refreshBooks: async () => {
    if (!window.toolbox) return
    set({ books: await window.toolbox.books.list() })
  },

  refreshGroups: async () => {
    if (!window.toolbox) return
    set({ groups: await window.toolbox.groups.list() })
  },

  importBook: async () => {
    const book = await window.toolbox.books.import()
    if (book) set((state) => ({ books: [book, ...state.books] }))
  },

  openReader: (bookId, chapterIdx) => set({ view: 'reading', activeBookId: bookId, readerStartChapter: chapterIdx ?? null, searchTarget: null }),
  closeReader: () => set({ view: 'shelf', activeBookId: null }),

  deleteBook: async (bookId) => {
    await window.toolbox.books.delete(bookId)
    set((state) => ({
      books: state.books.filter((item) => item.id !== bookId),
      activeBookId: state.activeBookId === bookId ? null : state.activeBookId
    }))
  },

  reorderBooks: async (ids) => {
    await window.toolbox.books.reorder(ids)
    set({ books: await window.toolbox.books.list() })
  },

  updateBookMeta: async (id, meta) => {
    const updated = await window.toolbox.books.updateMeta(id, meta)
    set((state) => ({ books: state.books.map((item) => (item.id === id ? updated : item)) }))
  },

  setCover: async (bookId) => {
    await window.toolbox.books.setCover(bookId)
    const books = await window.toolbox.books.list()
    set({ books })
  },

  setBooksGroup: async (ids, groupId) => {
    await window.toolbox.books.setGroup(ids, groupId)
    set({ books: await window.toolbox.books.list() })
  },

  createGroup: async (name) => {
    const group = await window.toolbox.groups.create(name)
    set((state) => ({ groups: [group, ...state.groups] }))
    return group
  },

  renameGroup: async (id, name) => {
    await window.toolbox.groups.rename(id, name)
    set({ groups: await window.toolbox.groups.list() })
  },

  deleteGroup: async (id) => {
    await window.toolbox.groups.delete(id)
    set({ groups: await window.toolbox.groups.list() })
  },

  // ---------- 密码箱 ----------
  refreshPasswords: async () => {
    if (!window.toolbox) return
    set({ passwords: await window.toolbox.passwords.list() })
  },

  savePasswordEntry: async (input) => {
    await window.toolbox.passwords.save(input)
    set({ passwords: await window.toolbox.passwords.list() })
  },

  deletePasswordEntry: async (id) => {
    await window.toolbox.passwords.delete(id)
    set((state) => ({ passwords: state.passwords.filter((item) => item.id !== id) }))
  },

  togglePasswordFavorite: async (id, isFavorite) => {
    await window.toolbox.passwords.setFavorite(id, isFavorite)
    set((state) => ({
      passwords: state.passwords.map((item) =>
        item.id === id ? { ...item, isFavorite } : item
      )
    }))
  },

  savePasswordDrafts: async (drafts) => {
    const imported = await window.toolbox.passwords.importSave(drafts)
    set({ passwords: await window.toolbox.passwords.list() })
    return imported
  },

  // ---------- 记事本 ----------
  refreshNotes: async () => {
    if (!window.toolbox) return
    set({ notes: await window.toolbox.notes.list() })
  },

  saveNote: async (input) => {
    const note = await window.toolbox.notes.save(input)
    set((state) => ({
      notes: [note, ...state.notes.filter((item) => item.id !== note.id)]
    }))
    return note
  },

  deleteNote: async (id) => {
    await window.toolbox.notes.delete(id)
    set((state) => ({ notes: state.notes.filter((item) => item.id !== id) }))
  },

  importNote: async () => {
    const note = await window.toolbox.notes.import()
    if (note) set((state) => ({ notes: [note, ...state.notes] }))
    return note
  },

  exportNote: async (id) => window.toolbox.notes.export(id),

  // ---------- 统计 ----------
  refreshStats: async () => {
    if (!window.toolbox) return
    set({ stats: await window.toolbox.stats.summary() })
  },

  // ---------- 设置 ----------
  saveProfile: async (input) => {
    const settings = await window.toolbox.settings.save(input)
    set({ settings })
    void get().loadChatModels()
    return settings
  },

  removeProfile: async (id) => {
    const settings = await window.toolbox.settings.remove(id)
    set({ settings })
    void get().loadChatModels()
    return settings
  },

  activateProfile: async (id) => {
    const settings = await window.toolbox.settings.activate(id)
    set({ settings })
    void get().loadChatModels()
    return settings
  },

  fetchModels: (input) => window.toolbox.settings.fetchModels(input),

  copyText: async (text) => window.toolbox.system.copyText(text),

  // ---------- 对话侧模型下拉 ----------
  loadChatModels: async () => {
    const active = activeProfileOf(get().settings)
    if (!active) {
      set({ chatModels: [] })
      return
    }
    // 下拉只显示用户在设置里勾选的模型；没勾过就回落到供应商内置推荐。
    // 这里不请求供应商接口：拉取只发生在设置页，聊天页要的是一份稳定的清单。
    set({
      chatModels: resolveChatModels(active.model, active.selectedModels, findAiProvider(active.provider).models)
    })
  },

  selectModel: async (model) => {
    const active = activeProfileOf(get().settings)
    if (!active || !model || model === active.model) return
    try {
      const settings = await window.toolbox.settings.save({
        id: active.id,
        name: active.name,
        provider: active.provider,
        baseUrl: active.baseUrl,
        model
      })
      set({ settings })
      // 换了当前模型，候选清单的顺序也跟着变（当前模型排最前）
      void get().loadChatModels()
    } catch (error) {
      set({ error: toErrorMessage(error) })
    }
  }
}))

function activeProfileOf(settings: AiConfigView | null): AiProfileView | null {
  if (!settings) return null
  return settings.profiles.find((item) => item.id === settings.activeId) ?? null
}

function upsertConversation(
  conversations: ConversationSummary[],
  next: ConversationSummary
): ConversationSummary[] {
  const rest = conversations.filter((item) => item.id !== next.id)
  return [next, ...rest].sort((a, b) => b.updatedAtMs - a.updatedAtMs)
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  return '操作失败，请稍后重试'
}
