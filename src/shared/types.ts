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

// ============ 阅读配置 ============

/** 翻页模式：上下滚动 / 左右翻页 / 覆盖翻页 */
export type PageMode = 'scroll' | 'horizontal' | 'cover'

/** 书架排序：手动 / 最近阅读 / 添加时间 / 书名 */
export type BookshelfSort = 'manual' | 'recentRead' | 'addedTime' | 'title'

/** 老板键伪装目标：无 / Excel / Word */
export type DisguiseTarget = 'none' | 'excel' | 'word'

export interface ReadConfig {
  fontSize: number
  lineSpacing: number
  fontFamily: string
  themeIndex: number
  nightMode: boolean
  pageMode: PageMode
  brightnessMask: number
  disguiseTarget: DisguiseTarget
  blurOnFocusLost: boolean
  bossHotkey: string
  pinned: boolean
  appBgPreset: number
  appBgImage: string
  bookshelfSort: BookshelfSort
  lockEnabled: boolean
  relockDelayMs: number
}

export interface ReaderTheme {
  name: string
  background: string
  foreground: string
}

/** 与旧项目 reader_menu.dart 一致的 5 套主题，默认索引 1（米黄） */
export const READER_THEMES: ReaderTheme[] = [
  { name: '纸白', background: '#F7F7F5', foreground: '#2B2B2B' },
  { name: '米黄', background: '#F5EFDC', foreground: '#3B3226' },
  { name: '护眼绿', background: '#CCE8CF', foreground: '#243326' },
  { name: '羊皮纸', background: '#E8DCC0', foreground: '#4A3B2A' },
  { name: '夜黑', background: '#121212', foreground: '#B8B8B8' }
]

export const NIGHT_THEME: ReaderTheme = {
  name: '夜间',
  background: '#121212',
  foreground: '#9E9E9E'
}

export const FONT_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: '默认' },
  { value: 'SimSun', label: '宋体' },
  { value: 'SimHei', label: '黑体' },
  { value: 'KaiTi', label: '楷体' },
  { value: 'Microsoft YaHei', label: '雅黑' }
]

export const DEFAULT_READ_CONFIG: ReadConfig = {
  fontSize: 19,
  lineSpacing: 1.6,
  fontFamily: '',
  themeIndex: 1,
  nightMode: false,
  pageMode: 'scroll',
  brightnessMask: 0,
  disguiseTarget: 'none',
  blurOnFocusLost: true,
  bossHotkey: 'Alt+H',
  pinned: false,
  appBgPreset: 0,
  appBgImage: '',
  bookshelfSort: 'manual',
  lockEnabled: false,
  relockDelayMs: 60_000
}

export function effectiveReaderTheme(config: ReadConfig): ReaderTheme {
  if (config.nightMode) return NIGHT_THEME
  return READER_THEMES[config.themeIndex] ?? READER_THEMES[1]
}

// ============ 书架 / 阅读器 ============

export interface BookGroup {
  id: string
  name: string
  sortIndex: number
}

export interface BookSummary {
  id: string
  title: string
  author: string
  chapterCount: number
  coverPath: string
  sortIndex: number
  groupId: string | null
  createdAtMs: number
  updatedAtMs: number
  progress: {
    chapterIdx: number
    percent: number
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
  percent: number
}

export interface Bookmark {
  id: string
  bookId: string
  chapterIdx: number
  pageIdx: number
  /** 章内比例（0~1），用于跳转时换算页码 */
  pageIdxRatio: number
  snippet: string
  createdAtMs: number
}

export interface SearchHit {
  chapterIdx: number
  chapterTitle: string
  pageIdx: number
  before: string
  match: string
  after: string
}

export interface ReadingStat {
  date: string
  durationMs: number
  charCount: number
}

export interface StatsSummary {
  todayDurationMs: number
  totalDurationMs: number
  totalCharCount: number
  recent: ReadingStat[]
}

// ============ 密码箱 ============

export interface PasswordInput {
  title: string
  url: string
  account: string
  password: string
  remark: string
  isFavorite?: boolean
  updatedAtMs?: number
}

export interface PasswordEntryView extends PasswordInput {
  id: string
  firstLetter: string
  isFavorite: boolean
  isDecryptable: boolean
  createdAtMs: number
  updatedAtMs: number
}

export type PasswordImportMode = 'fixed' | 'ai'

export interface PasswordDraft {
  title: string
  url: string
  account: string
  password: string
  remark: string
  updatedAtMs?: number
  duplicate?: boolean
}

export interface PasswordImportOutcome {
  entries: PasswordDraft[]
  skipped: number
}

// ============ 记事本 ============

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

// ============ 设置 / 系统 ============

export interface AppInfo {
  name: string
  version: string
  platform: string
}

export interface BackgroundPreset {
  index: number
  name: string
  color: string
  dark: boolean
}

export const BACKGROUND_PRESETS: BackgroundPreset[] = [
  { index: 0, name: '白', color: '#FFFFFF', dark: false },
  { index: 1, name: '灰', color: '#F2F3F5', dark: false },
  { index: 2, name: '黑', color: '#121212', dark: true }
]

export type RelockDelay = 0 | 60_000 | 300_000

export const RELOCK_OPTIONS: Array<{ value: RelockDelay; label: string }> = [
  { value: 0, label: '立即' },
  { value: 60_000, label: '1 分钟' },
  { value: 300_000, label: '5 分钟' }
]