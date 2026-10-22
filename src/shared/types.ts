export type ChatRole = 'user' | 'assistant'

/** 本机网卡的只读地址视图，不包含 MAC、网关或公网探测信息。 */
export interface LocalIpAddressView {
  interfaceName: string
  address: string
  family: 'IPv4' | 'IPv6'
  netmask: string
}

// ============ 外部编程 Agent：OpenCode ============

/** 仅包含程序与目录信息，不包含 OpenCode 登录凭据。 */
export interface OpenCodeInfo {
  executablePath: string | null
  directory: string
  version: string | null
  connected: boolean
  canLoadSession: boolean
  /** Desktop 模型勾选与默认可见规则解析出的 id，不包含目录中的原始设置或请求头。 */
  visibleModelIds: string[]
}

/** ACP 握手/会话返回的可选配置，不假设模型与模式名称固定。 */
export interface OpenCodeOption {
  id: string
  name: string
  category: string
  currentValue: string
  options: Array<{ value: string; label: string }>
}

/** 待用户单次允许或拒绝的外部工具操作。 */
export interface OpenCodeApproval {
  id: string
  title: string
  details: string
  canAllow: boolean
}

/** 工作台的有界文本/工具视图；完整会话由 OpenCode 保存。 */
export interface OpenCodeSession {
  id: string
  title: string
  directory: string
  status: 'ready' | 'running' | 'stopping' | 'disconnected' | 'error'
  messages: Array<{ id: string; role: ChatRole; content: string }>
  tools: Array<{ id: string; title: string; status: string }>
  options: OpenCodeOption[]
  approvals: OpenCodeApproval[]
  error: string
}

/** OpenCode 原生会话列表摘要，恢复时仍校验工作目录。 */
export interface OpenCodeSessionSummary {
  id: string
  title: string
}

/** 连接状态与会话更新分别推送，避免退出连接后残留运行中状态。 */
export type OpenCodeEvent =
  | { kind: 'connection'; connected: boolean }
  | { kind: 'session'; session: OpenCodeSession }

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
    /**
     * 内置推荐 = 供应商目录的**兜底快照**，不是全部。
     * 实测该目录是动态的（两次请求返回的模型数都不一样），
     * 所以只保一批主流模型，真正的完整列表靠「获取模型」实时拉取。
     */
    models: [
      'glm-5.3',
      'glm-5.3-flash',
      'glm-5.2',
      'grok-4.6',
      'grok-4.7',
      'gpt-6-luna',
      'gpt-5.6-luna',
      'claude-haiku-5-5',
      'kimi-k3',
      'kimi-k2.7-code',
      'minimax-m3',
      'minimax-m2.7',
      'mimo-v2.6-pro',
      'qwen3.7-max',
      'qwen3.8-max',
      'deepseek-v4-pro',
      'deepseek-v4.1-flash'
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
  /**
   * 用户在设置里勾选的模型清单。
   *
   * 对话下拉**只显示这里勾选的模型**（外加当前正在用的那个）。
   * 为空时回落到该供应商的内置推荐 —— 这样新配置第一次用也不会是空下拉。
   */
  selectedModels?: string[]
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
  /** 对话下拉要显示的模型清单；留空表示沿用已保存的勾选，空数组表示清空 */
  selectedModels?: string[]
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

// ============ AI 助手 Agent（工具接管） ============

/**
 * Agent 权限档位（对标编辑器 Agent 的三档）：
 * - readonly  只读：仅暴露只读工具，任何写操作都不可用
 * - confirm  写操作需确认：只读自动执行，写 / 破坏性工具执行前需用户批准
 * - full     完全访问：所有工具自动执行
 */
export const AGENT_PERMISSION_MODES = ['readonly', 'confirm', 'full'] as const

export type AgentPermission = (typeof AGENT_PERMISSION_MODES)[number]

export const DEFAULT_AGENT_PERMISSION: AgentPermission = 'confirm'

/** Agent 权限的人类可读标签 */
export const AGENT_PERMISSION_LABELS: Record<AgentPermission, string> = {
  readonly: '只读',
  confirm: '写操作确认',
  full: '完全访问'
}

export function isAgentPermission(value: unknown): value is AgentPermission {
  return (
    typeof value === 'string' && (AGENT_PERMISSION_MODES as readonly string[]).includes(value)
  )
}

/** 工具风险级别：决定 confirm 档位下是否需要人工确认 */
export type AgentToolRisk = 'read' | 'write' | 'destructive'

/** 工具开始执行（已获批准或无需批准） */
export interface AgentToolCallEvent {
  conversationId: string
  callId: string
  name: string
  /** 人类可读的入参摘要（截断、脱敏） */
  args: string
}

/** 工具执行结束 */
export interface AgentToolResultEvent {
  conversationId: string
  callId: string
  ok: boolean
  /** 结果摘要（截断、脱敏） */
  summary: string
}

/** 请求用户批准一个写 / 破坏性工具调用 */
export interface AgentToolApprovalRequestEvent {
  conversationId: string
  callId: string
  name: string
  args: string
  risk: AgentToolRisk
}

/** 渲染层对审批请求的答复 */
export interface AgentToolApprovalInput {
  conversationId: string
  callId: string
  approved: boolean
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

/** 书内搜索命中（两端同名同义） */
export interface ChapterSearchHit {
  chapterIdx: number
  chapterTitle: string
  /** 命中位置在章节正文里的比例（0~1），用于直接跳过去 */
  ratio: number
  /** 命中前后的正文片段 */
  before: string
  match: string
  after: string
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

/** 任意日期区间的阅读统计 */
export interface StatsRange {
  fromDate: string
  toDate: string
  totalDurationMs: number
  totalCharCount: number
  /** 区间内有阅读记录的天数 */
  activeDays: number
  daily: ReadingStat[]
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

// ============ 全局快捷键 ============

/**
 * 全局快捷键配置：唤起百宝箱窗口。
 *
 * 默认关闭 —— 全局占用快捷键容易和别的程序打架，该由用户自己开。
 */
export interface ShortcutConfig {
  /** 是否启用 */
  enabled: boolean
  /** Electron accelerator 写法，例如 Control+Shift+Space */
  accelerator: string
}

/** 可选的快捷键组合：给用户选而不是手输，避免拼错 */
export const SHORTCUT_ACCELERATORS: readonly string[] = [
  'Control+Shift+Space',
  'Control+Shift+K',
  'Control+Alt+T',
  'Alt+Space'
]

/** 默认配置：关闭状态 + 默认组合 */
export const DEFAULT_SHORTCUT_CONFIG: ShortcutConfig = {
  enabled: false,
  accelerator: 'Control+Shift+Space'
}

/** 设置全局快捷键的结果 */
export interface ShortcutSetResult {
  /** 是否设置成功 */
  ok: boolean
  /** 失败原因（快捷键被占用等），成功时为空 */
  error?: string
  /** 当前生效的配置（失败时是原来的那一份） */
  config: ShortcutConfig
}
