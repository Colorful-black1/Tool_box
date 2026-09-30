export type ChatRole = 'user' | 'assistant'

export interface AiConfig {
  baseUrl: string
  model: string
  apiKey: string
}

export interface AiConfigView {
  baseUrl: string
  model: string
  hasApiKey: boolean
}

export interface AiConfigInput {
  baseUrl: string
  model: string
  apiKey?: string
}

export interface ConversationSummary {
  id: string
  title: string
  createdAtMs: number
  updatedAtMs: number
  messageCount: number
}

export interface ChatMessage {
  id: string
  conversationId: string
  role: ChatRole
  content: string
  createdAtMs: number
}

export interface ChatSendRequest {
  conversationId: string
  content: string
}

export interface ChatSendResult {
  userMessage: ChatMessage
  conversation: ConversationSummary
}

export interface ChatDeltaEvent {
  conversationId: string
  delta: string
}

export interface ChatCompletedEvent {
  conversationId: string
  message: ChatMessage
  conversation: ConversationSummary
}

export interface ChatErrorEvent {
  conversationId: string
  message: string
}

export interface ChatStoppedEvent {
  conversationId: string
}

export interface BookSummary {
  id: string
  title: string
  chapterCount: number
  createdAtMs: number
  updatedAtMs: number
  progress: {
    chapterIdx: number
    offsetRatio: number
    updatedAtMs: number
  } | null
}

export interface ChapterMeta {
  id: string
  idx: number
  title: string
  wordCount: number
}

export interface ChapterContent {
  id: string
  idx: number
  title: string
  content: string
}

export interface ReadingProgressInput {
  bookId: string
  chapterIdx: number
  offsetRatio: number
}

export interface PasswordInput {
  title: string
  url: string
  account: string
  password: string
  remark: string
  isFavorite?: boolean
}

export interface PasswordEntryView extends PasswordInput {
  id: string
  isFavorite: boolean
  createdAtMs: number
  updatedAtMs: number
}

export interface NoteSaveInput {
  id?: string
  title: string
  content: string
}

export interface NoteView {
  id: string
  title: string
  content: string
  createdAtMs: number
  updatedAtMs: number
}

export interface ImportResult {
  imported: number
  skipped: number
}
