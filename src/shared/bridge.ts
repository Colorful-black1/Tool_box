import type {
  AiConfigInput,
  AiConfigView,
  BookSummary,
  ChatCompletedEvent,
  ChatDeltaEvent,
  ChatErrorEvent,
  ChatMessage,
  ChatSendRequest,
  ChatSendResult,
  ChatStoppedEvent,
  ChapterContent,
  ChapterMeta,
  ConversationSummary,
  ImportResult,
  NoteSaveInput,
  NoteView,
  PasswordEntryView,
  PasswordInput
} from './types'

export interface ToolboxBridge {
  settings: {
    get(): Promise<AiConfigView>
    save(input: AiConfigInput): Promise<AiConfigView>
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
    import(): Promise<BookSummary | null>
    listChapters(bookId: string): Promise<ChapterMeta[]>
    chapterContent(chapterId: string): Promise<ChapterContent>
    progressGet(bookId: string): Promise<{ chapterIdx: number; offsetRatio: number } | null>
    progressSave(bookId: string, chapterIdx: number, offsetRatio: number): Promise<void>
    delete(bookId: string): Promise<void>
  }
  passwords: {
    list(): Promise<PasswordEntryView[]>
    save(input: PasswordInput & { id?: string }): Promise<void>
    delete(id: string): Promise<void>
    setFavorite(id: string, isFavorite: boolean): Promise<void>
    import(): Promise<ImportResult | null>
  }
  notes: {
    list(): Promise<NoteView[]>
    save(input: NoteSaveInput): Promise<NoteView>
    delete(id: string): Promise<void>
    import(): Promise<NoteView | null>
    export(id: string): Promise<string | null>
  }
  system: {
    copyText(text: string): Promise<void>
  }
}
