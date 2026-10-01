export type ChatRole = 'user' | 'assistant'

/** 主进程内部使用：含明文 Key，绝不跨 IPC 传输 */
export interface AiConfig {
  provider: AiProviderId
  baseUrl: string
  model: string
  apiKey: string
}

// ============ AI 供应商 ============

export const AI_PROVIDER_IDS = [
  'deepseek',
  'glm',
  'mimo',
  'openai',
  'opencode-go',
  'kimi',
  'qwen',
  'siliconflow',
  'custom'
] as const

/** 内置供应商 id；custom 表示用户自定义 OpenAI 兼容端点 */
export type AiProviderId = (typeof AI_PROVIDER_IDS)[number]

export interface AiProviderPreset {
  id: AiProviderId
  name: string
  /** OpenAI 兼容端点（custom 为空，由用户填写） */
  baseUrl: string
  /** 内置推荐模型：远端拉取失败时降级展示 */
  models: string[]
  /** 申请 API Key 的控制台地址 */
  consoleUrl: string
}

/**
 * 内置供应商预设表（端点取自各家官方 OpenAI 兼容文档）。
 * 用户切换供应商时自动填入 baseUrl 与首个推荐模型；
 * 不在表内的服务商一律走 custom 手填。
 */
export const AI_PROVIDER_PRESETS: readonly AiProviderPreset[] = [
  {
    id: 'deepseek',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    models: ['deepseek-v4-pro', 'deepseek-v4-flash', 'deepseek-v4-flash-vision-exp'],
    consoleUrl: 'https://platform.deepseek.com/'
  },
  {
    id: 'glm',
    name: '智谱 GLM',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    models: ['glm-5.3', 'glm-5.3-flash', 'glm-5.2', 'glm-4.7-flash'],
    consoleUrl: 'https://open.bigmodel.cn/'
  },
  {
    id: 'mimo',
    name: '小米 MiMo',
    baseUrl: 'https://api.xiaomimimo.com/v1',
    models: ['mimo-v2.5-pro', 'mimo-v2.5'],
    consoleUrl: 'https://platform.xiaomimimo.com/'
  },
  {
    id: 'openai',
    name: 'OpenAI GPT',
    baseUrl: 'https://api.openai.com/v1',
    models: ['gpt-5.1', 'gpt-5', 'gpt-4.1', 'gpt-4o', 'gpt-4o-mini'],
    consoleUrl: 'https://platform.openai.com/'
  },
  {
    id: 'opencode-go',
    name: 'OpenCode Go',
    baseUrl: 'https://opencode.ai/zen/go/v1',
    models: [
      'glm-5.3',
      'glm-5.3-flash',
      'kimi-k3',
      'minimax-m3',
      'qwen3.7-max',
      'deepseek-v4-pro',
      'deepseek-v4-flash',
      'grok-4.6'
    ],
    consoleUrl: 'https://opencode.ai/go'
  },
  {
    id: 'kimi',
    name: 'Kimi 月之暗面',
    baseUrl: 'https://api.moonshot.cn/v1',
    models: ['kimi-k2.5', 'kimi-k2-turbo-preview', 'moonshot-v1-128k', 'moonshot-v1-32k'],
    consoleUrl: 'https://platform.moonshot.cn/'
  },
  {
    id: 'qwen',
    name: '通义千问 Qwen',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    models: ['qwen3-max', 'qwen3.5-plus', 'qwen3.5-turbo', 'qwen-plus', 'qwen-turbo'],
    consoleUrl: 'https://bailian.console.aliyun.com/'
  },
  {
    id: 'siliconflow',
    name: 'SiliconFlow 硅基流动',
    baseUrl: 'https://api.siliconflow.cn/v1',
    models: [
      'deepseek-ai/DeepSeek-V3.2',
      'deepseek-ai/DeepSeek-R1',
      'Qwen/Qwen3-235B-A22B-Instruct-2507',
      'moonshotai/Kimi-K2-Instruct-0905'
    ],
    consoleUrl: 'https://cloud.siliconflow.cn/'
  },
  {
    id: 'custom',
    name: '自定义（OpenAI 兼容）',
    baseUrl: '',
    models: [],
    consoleUrl: ''
  }
]

export function findAiProvider(id: AiProviderId): AiProviderPreset {
  return AI_PROVIDER_PRESETS.find((preset) => preset.id === id) ?? AI_PROVIDER_PRESETS[0]
}

export function isAiProviderId(value: unknown): value is AiProviderId {
  return typeof value === 'string' && (AI_PROVIDER_IDS as readonly string[]).includes(value)
}

/** 按 baseUrl 反查供应商，用于旧配置迁移时补全 provider */
export function matchProviderByBaseUrl(baseUrl: string): AiProviderId {
  const target = baseUrl.trim().replace(/\/+$/, '').toLowerCase()
  if (!target) return 'custom'
  const hit = AI_PROVIDER_PRESETS.find(
    (preset) => preset.baseUrl && preset.baseUrl.replace(/\/+$/, '').toLowerCase() === target
  )
  return hit?.id ?? 'custom'
}

// ============ AI 配置档案（多套，一键切换） ============

/** 脱敏档案视图：只暴露 hasApiKey，不含明文 Key */
export interface AiProfileView {
  id: string
  name: string
  provider: AiProviderId
  baseUrl: string
  model: string
  hasApiKey: boolean
}

export interface AiConfigView {
  profiles: AiProfileView[]
  activeId: string | null
}

export interface AiProfileInput {
  /** 留空表示新建档案 */
  id?: string
  name: string
  provider: AiProviderId
  baseUrl: string
  model: string
  /** 留空表示沿用已保存的 Key */
  apiKey?: string
}

/** 获取模型列表入参：apiKey 留空时回落到档案已保存的 Key */
export interface AiFetchModelsInput {
  profileId?: string
  provider: AiProviderId
  baseUrl: string
  apiKey?: string
}

/** remote = 供应商接口实时返回；preset = 远端失败，降级为内置推荐列表 */
export type AiModelSource = 'remote' | 'preset'

export interface AiModelListResult {
  models: string[]
  source: AiModelSource
  /** 降级或异常提示文案（已脱敏） */
  message?: string
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