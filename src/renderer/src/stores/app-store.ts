import { create } from 'zustand'

import type {
  AiConfigView,
  AiFetchModelsInput,
  AiModelListResult,
  AiProfileInput,
  AppInfo,
  BookGroup,
  BookSummary,
  ChatCompletedEvent,
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

export type AppView =
  | 'chat'
  | 'shelf'
  | 'reading'
  | 'stats'
  | 'passwords'
  | 'notes'
  | 'settings'

interface StreamingState {
  conversationId: string
  content: string
}

interface AppState {
  bootstrapped: boolean
  loading: boolean
  view: AppView
  error: string | null
  appInfo: AppInfo | null

  settings: AiConfigView | null
  conversations: ConversationSummary[]
  activeConversationId: string | null
  messages: ChatMessage[]
  streaming: StreamingState | null

  books: BookSummary[]
  groups: BookGroup[]
  activeBookId: string | null

  passwords: PasswordEntryView[]
  notes: NoteView[]
  stats: StatsSummary | null

  bootstrap(): Promise<void>
  setView(view: AppView): void
  clearError(): void

  // AI 对话
  refreshConversations(): Promise<void>
  selectConversation(id: string): Promise<void>
  createConversation(): Promise<void>
  renameConversation(id: string, title: string): Promise<void>
  deleteConversation(id: string): Promise<void>
  sendMessage(content: string): Promise<void>
  stopGeneration(): Promise<void>
  appendDelta(event: ChatDeltaEvent): void
  completeChat(event: ChatCompletedEvent): void
  failChat(event: ChatErrorEvent): void
  stopChat(event: ChatStoppedEvent): void

  // 书架
  refreshBooks(): Promise<void>
  refreshGroups(): Promise<void>
  importBook(): Promise<void>
  openReader(bookId: string): void
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
}

export const useAppStore = create<AppState>((set, get) => ({
  bootstrapped: false,
  loading: true,
  view: 'chat',
  error: null,
  appInfo: null,
  settings: null,
  conversations: [],
  activeConversationId: null,
  messages: [],
  streaming: null,
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

      set({
        bootstrapped: true,
        loading: false,
        settings,
        conversations,
        activeConversationId,
        messages,
        books,
        groups,
        passwords,
        notes,
        appInfo
      })
    } catch (error) {
      set({ loading: false, error: toErrorMessage(error) })
    }
  },

  setView: (view) => set({ view }),
  clearError: () => set({ error: null }),

  // ---------- AI 对话 ----------
  refreshConversations: async () => {
    const conversations = await window.toolbox.chat.listConversations()
    set({ conversations })
  },

  selectConversation: async (id) => {
    if (get().activeConversationId === id) return
    set({ activeConversationId: id, messages: [], error: null })
    const messages = await window.toolbox.chat.listMessages(id)
    if (get().activeConversationId === id) set({ messages })
  },

  createConversation: async () => {
    const conversation = await window.toolbox.chat.createConversation()
    set((state) => ({
      conversations: [conversation, ...state.conversations],
      activeConversationId: conversation.id,
      messages: [],
      error: null
    }))
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
        messages
      })
      return
    }
    const conversation = await window.toolbox.chat.createConversation()
    set({
      conversations: [conversation],
      activeConversationId: conversation.id,
      messages: []
    })
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
        streaming: { conversationId: activeConversationId, content: '' }
      }))
    } catch (error) {
      set({ error: toErrorMessage(error) })
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
          : state.streaming
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
          : state.streaming
    })),

  stopChat: (event) =>
    set((state) => ({
      streaming:
        state.streaming?.conversationId === event.conversationId
          ? null
          : state.streaming
    })),

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

  openReader: (bookId) => set({ view: 'reading', activeBookId: bookId }),
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
    return settings
  },

  removeProfile: async (id) => {
    const settings = await window.toolbox.settings.remove(id)
    set({ settings })
    return settings
  },

  activateProfile: async (id) => {
    const settings = await window.toolbox.settings.activate(id)
    set({ settings })
    return settings
  },

  fetchModels: (input) => window.toolbox.settings.fetchModels(input),

  copyText: async (text) => window.toolbox.system.copyText(text)
}))

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