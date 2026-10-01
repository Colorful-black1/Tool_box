import type {
  AiConfigInput,
  AiConfigView,
  AppInfo,
  BookGroup,
  BookSummary,
  Bookmark,
  ChapterContent,
  ChapterMeta,
  ChatCompletedEvent,
  ChatDeltaEvent,
  ChatErrorEvent,
  ChatMessage,
  ChatSendRequest,
  ChatSendResult,
  ChatStoppedEvent,
  ConversationSummary,
  ImportResult,
  NoteSaveInput,
  NoteView,
  PasswordDraft,
  PasswordEntryView,
  PasswordInput,
  ReadingProgressInput,
  StatsSummary
} from './types'

export interface ToolboxBridge {
  app: {
    info(): Promise<AppInfo>
  }
  settings: {
    get(): Promise<AiConfigView>
    save(input: AiConfigInput): Promise<AiConfigView>
  }
  config: {
    get(): Promise<Record<string, unknown> | null>
    set(patch: Record<string, unknown>): Promise<Record<string, unknown> | null>
  }
  chat: {
    listConversations(): Promise<ConversationSummary[]>
    createConversation(): Promise<ConversationSummary>
    renameConversation(id: string, title: string): Promise<ConversationSummary>
    deleteConversation(id: string): Promise<void>
    listMessages(conversationId: string): Promise<ChatMessage[]>
    send(request: ChatSendRequest): Promise<ChatSendResult>
    stop(conversationId: string): Promise<void>
    onDelta(listener: (event: ChatDeltaEvent) => void): () => void
    onCompleted(listener: (event: ChatCompletedEvent) => void): () => void
    onError(listener: (event: ChatErrorEvent) => void): () => void
    onStopped(listener: (event: ChatStoppedEvent) => void): () => void
  }
  books: {
    list(): Promise<BookSummary[]>
    search(query: string): Promise<BookSummary[]>
    import(): Promise<BookSummary | null>
    listChapters(bookId: string): Promise<ChapterMeta[]>
    chapterContent(chapterId: string): Promise<ChapterContent>
    progressGet(bookId: string): Promise<{ chapterIdx: number; percent: number } | null>
    progressSave(input: ReadingProgressInput): Promise<void>
    delete(bookId: string): Promise<void>
    reorder(orderedIds: string[]): Promise<void>
    updateMeta(
      id: string,
      meta: { title?: string; author?: string }
    ): Promise<BookSummary>
    /** 主进程弹出图片选择框并复制到受管目录；取消时静默返回 */
    setCover(id: string): Promise<void>
    setGroup(ids: string[], groupId: string | null): Promise<void>
  }
  groups: {
    list(): Promise<BookGroup[]>
    create(name: string): Promise<BookGroup>
    rename(id: string, name: string): Promise<void>
    delete(id: string): Promise<void>
  }
  bookmarks: {
    list(bookId: string): Promise<Bookmark[]>
    toggle(input: {
      bookId: string
      chapterIdx: number
      pageIdx: number
      pageIdxRatio: number
      snippet: string
    }): Promise<{ active: boolean }>
    delete(id: string): Promise<void>
  }
  stats: {
    summary(): Promise<StatsSummary>
    flush(input: { durationMs: number; charCount: number }): Promise<void>
  }
  passwords: {
    list(): Promise<PasswordEntryView[]>
    save(input: PasswordInput & { id?: string }): Promise<void>
    delete(id: string): Promise<void>
    setFavorite(id: string, isFavorite: boolean): Promise<void>
    importFixed(): Promise<ImportResult | null>
    importAi(): Promise<PasswordDraft[] | null>
    importSave(drafts: PasswordDraft[]): Promise<number>
  }
  notes: {
    list(): Promise<NoteView[]>
    save(input: NoteSaveInput): Promise<NoteView>
    delete(id: string): Promise<void>
    import(): Promise<NoteView | null>
    export(id: string): Promise<string | null>
  }
  background: {
    pick(): Promise<string | null>
    clear(): Promise<void>
  }
  system: {
    copyText(text: string): Promise<void>
  }
}