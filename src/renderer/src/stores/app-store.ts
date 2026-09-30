import { create } from 'zustand'

import type {
  AiConfigInput,
  AiConfigView,
  BookSummary,
  ChapterContent,
  ChapterMeta,
  ChatCompletedEvent,
  ChatDeltaEvent,
  ChatErrorEvent,
  ChatMessage,
  ChatStoppedEvent,
  ConversationSummary,
  ImportResult,
  NoteSaveInput,
  NoteView,
  PasswordEntryView,
  PasswordInput
} from '../../../shared/types'

export type AppView = 'chat' | 'shelf' | 'reading' | 'passwords' | 'notes' | 'settings'

interface StreamingState {
  conversationId: string
  content: string
}

interface AppState {
  bootstrapped: boolean
  loading: boolean
  view: AppView
  error: string | null

  settings: AiConfigView | null
  conversations: ConversationSummary[]
  activeConversationId: string | null
  messages: ChatMessage[]
  streaming: StreamingState | null

  books: BookSummary[]
  activeBookId: string | null
  chapters: ChapterMeta[]
  chapterContent: ChapterContent | null

  passwords: PasswordEntryView[]
  notes: NoteView[]

  bootstrap(): Promise<void>
  setView(view: AppView): void

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

  // 小说
  refreshBooks(): Promise<void>
  importBook(): Promise<void>
  openReader(bookId: string): Promise<void>
  loadBook(bookId: string): Promise<void>
  gotoChapter(idx: number): Promise<void>
  closeReader(): void
  deleteBook(bookId: string): Promise<void>

  // 密码箱
  refreshPasswords(): Promise<void>
  savePasswordEntry(
    input: PasswordInput & { id?: string }
  ): Promise<void>
  deletePasswordEntry(id: string): Promise<void>
  togglePasswordFavorite(id: string, isFavorite: boolean): Promise<void>
  importPasswords(): Promise<ImportResult | null>

  // 记事本
  refreshNotes(): Promise<void>
  saveNote(input: NoteSaveInput): Promise<NoteView>
  deleteNote(id: string): Promise<void>
  importNote(): Promise<NoteView | null>
  exportNote(id: string): Promise<string | null>

  // 设置 / 系统
  loadSettings(): Promise<void>
  saveSettings(input: AiConfigInput): Promise<AiConfigView>
  copyText(text: string): Promise<void>
  clearError(): void
}

export const useAppStore = create<AppState>((set, get) => ({
  bootstrapped: false,
  loading: true as unknown as never,
  view: 'chat',
  error: null,
  settings: null,
  conversations: [],
  activeConversationId: null,
  messages: [],
  streaming: null,
  books: [],
  activeBookId: null,
  chapters: [],
  chapterContent: null,
  passwords: [],
  notes: [],

  bootstrap: async () => {
    if (get().bootstrapped) return
    if (!window.toolbox) {
      set({
        loading: false as unknown as never,
        error: '本地桥接未就绪：请通过桌面应用窗口运行（electron-vite dev）'
      })
      return
    }
    set({ loading: true as unknown as never })

    try {
      const bridge = window.toolbox
      const [settings, existingConversations] = await Promise.all([
        bridge.settings.get(),
        bridge.chat.listConversations()
      ])

      let conversations = existingConversations
      if (conversations.length === 0) {
        conversations = [await bridge.chat.createConversation()]
      }

      const activeConversationId = conversations[0]?.id ?? null
      const messages = activeConversationId
        ? await bridge.chat.listMessages(activeConversationId)
        : []

      const [books, passwords, notes] = await Promise.all([
        bridge.books.list(),
        bridge.passwords.list(),
        bridge.notes.list()
      ])

      set({
        bootstrapped: true,
        loading: false as unknown as never,
        settings,
        conversations,
        activeConversationId,
        messages,
        books,
        passwords,
        notes
      })
    } catch (error) {
      set({ loading: false as unknown as never, error: toErrorMessage(error) })
    }
  },

  setView: (view) => set({ view }),

  refreshConversations: async () => {
    const conversations = await window.toolbox.chat.listConversations()
    set((state) => ({
      conversations,
      activeConversationId:
        state.activeConversationId &&
        conversations.some((item) => item.id === state.activeConversationId)
          ? state.activeConversationId
          : conversations[0]?.id ?? null
    }))
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
      const nextId = remaining[0].id
      const messages = await window.toolbox.chat.listMessages(nextId)
      set({ conversations: remaining, activeConversationId: nextId, messages })
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
    try {
      await window.toolbox.chat.stop(activeConversationId)
    } catch (error) {
      set({ error: toErrorMessage(error) })
    }
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

  refreshBooks: async () => {
    if (!window.toolbox) {
      set({ error: '本地桥接未就绪：请通过桌面应用窗口运行（electron-vite dev）' })
      return
    }
    const books = await window.toolbox.books.list()
    set({ books })
  },

  importBook: async () => {
    const book = await window.toolbox.books.import()
    if (book) {
      set((state) => ({ books: [book, ...state.books] }))
    }
  },

  openReader: async (bookId) => {
    set({ view: 'reading', activeBookId: bookId, chapters: [], chapterContent: null })
  },

  loadBook: async (bookId) => {
    const [chapters, progress] = await Promise.all([
      window.toolbox.books.listChapters(bookId),
      window.toolbox.books.progressGet(bookId)
    ])
    const startIdx = progress?.chapterIdx ?? 0
    const target = chapters[Math.min(startIdx, Math.max(chapters.length - 1, 0))]
    const content = target ? await window.toolbox.books.chapterContent(target.id) : null
    set({ chapters, chapterContent: content })
    if (target && progress) {
      // 恢复进度时保留原始偏移
      window.setTimeout(() => {
        const element = document.querySelector('.reader-page')
        if (element) element.scrollTop = progress.offsetRatio * element.scrollHeight * 0.9
      }, 0)
    }
  },

  gotoChapter: async (idx) => {
    const { chapters, activeBookId } = get()
    if (idx < 0 || idx >= chapters.length || !activeBookId) return
    const chapterMeta = chapters[idx]
    const content = await window.toolbox.books.chapterContent(chapterMeta.id)
    set({ chapterContent: content })
    void window.toolbox.books
      .progressSave(activeBookId, idx, 0)
      .catch(() => undefined)
    const refreshed = get().books.map((book) =>
      book.id === activeBookId
        ? {
            ...book,
            progress: {
              chapterIdx: idx,
              offsetRatio: 0,
              updatedAtMs: Date.now()
            }
          }
        : book
    )
    set({ books: refreshed })
  },

  closeReader: () => set({ view: 'shelf', chapterContent: null, chapters: [] }),

  deleteBook: async (bookId) => {
    await window.toolbox.books.delete(bookId)
    set((state) => ({
      books: state.books.filter((item) => item.id !== bookId),
      activeBookId: state.activeBookId === bookId ? null : state.activeBookId
    }))
  },

  refreshPasswords: async () => {
    if (!window.toolbox) return
    const passwords = await window.toolbox.passwords.list()
    set({ passwords })
  },

  savePasswordEntry: async (input) => {
    await window.toolbox.passwords.save(input)
    const passwords = await window.toolbox.passwords.list()
    set({ passwords })
  },

  deletePasswordEntry: async (id) => {
    await window.toolbox.passwords.delete(id)
    set((state) => ({ passwords: state.passwords.filter((entry) => entry.id !== id) }))
  },

  togglePasswordFavorite: async (id, isFavorite) => {
    await window.toolbox.passwords.setFavorite(id, isFavorite)
    set((state) => ({
      passwords: state.passwords.map((entry) =>
        entry.id === id ? { ...entry, isFavorite } : entry
      )
    }))
  },

  importPasswords: async () => {
    const result = await window.toolbox.passwords.import()
    if (result && result.imported > 0) {
      const passwords = await window.toolbox.passwords.list()
      set({ passwords })
    }
    return result
  },

  refreshNotes: async () => {
    if (!window.toolbox) return
    const notes = await window.toolbox.notes.list()
    set({ notes })
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
    set((state) => ({ notes: state.notes.filter((note) => note.id !== id) }))
  },

  importNote: async () => {
    const note = await window.toolbox.notes.import()
    if (note) set((state) => ({ notes: [note, ...state.notes] }))
    return note
  },

  exportNote: async (id) => window.toolbox.notes.export(id),

  loadSettings: async () => {
    const settings = await window.toolbox.settings.get()
    set({ settings })
  },

  saveSettings: async (input) => {
    const settings = await window.toolbox.settings.save(input)
    set({ settings })
    return settings
  },

  copyText: async (text) => window.toolbox.system.copyText(text),

  clearError: () => set({ error: null })
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
