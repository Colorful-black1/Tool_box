/**
 * 桌面端共享逻辑的**唯一引用点**。
 *
 * 桌面端与手机端共用的纯逻辑直接放在仓库根的 src/ 下（无 Node / Electron 依赖），
 * 由 metro.config.js 的 watchFolders 让 Metro 能解析到。这里集中再导出一次，
 * 好处：
 * - 手机端只有这一个文件带 `../../` 跨目录路径，日后桌面端目录调整只改这一处；
 * - 明确标出「哪些代码是双端共用的」，避免误引依赖 Node 的模块。
 *
 * 引入前请确认目标文件没有 import 'node:*' / 'electron' / better-sqlite3。
 */

// 共享契约：类型、供应商预设、常量
export {
  AGENT_PERMISSION_LABELS,
  AGENT_PERMISSION_MODES,
  AI_PROVIDER_IDS,
  AI_PROVIDER_PRESETS,
  DEFAULT_AGENT_PERMISSION,
  DEFAULT_READ_CONFIG,
  FONT_OPTIONS,
  NIGHT_THEME,
  READER_THEMES,
  effectiveReaderTheme,
  findAiProvider,
  isAgentPermission,
  isAiProviderId,
  matchProviderByBaseUrl
} from '../../src/shared/types'
export type {
  AgentPermission,
  AgentToolApprovalInput,
  AgentToolApprovalRequestEvent,
  AgentToolCallEvent,
  AgentToolResultEvent,
  AgentToolRisk,
  AiConfigView,
  AiFetchModelsInput,
  AiModelListResult,
  AiProfileInput,
  AiProfileView,
  AiProviderId,
  AiProviderPreset,
  BackgroundPreset,
  BookGroup,
  BookSummary,
  Bookmark,
  ChapterContent,
  ChapterMeta,
  ChapterSearchHit,
  ChatMessage,
  ChatRole,
  ConversationSummary,
  NoteSaveInput,
  NoteView,
  PageMode,
  PasswordDraft,
  PasswordEntryView,
  PasswordInput,
  ReadConfig,
  ReaderTheme,
  ReadingProgressInput,
  ReadingStat,
  StatsRange,
  StatsSummary
} from '../../src/shared/types'

// AI 错误映射与端点规范化：与桌面端共用，保证报错文案完全一致
export {
  AiGatewayError,
  describeAiError,
  normalizeOpenAiBaseUrl,
  redactSecret,
  validateChatInput
} from '../../src/main/services/ai-gateway/errors'

// 模型列表的纯解析器：兼容 OpenAI / Gemini / 裸数组三种返回结构。
// 只复用解析部分，不复用同文件的 fetchModelIds —— 那个用了 AbortSignal.timeout，RN 没有。
export { extractModelIds } from '../../src/main/services/ai-gateway/model-fetcher'

// 纯解析器：章节 / 密码文本 / 拼音首字母
export { normalizeChapterText, parseChapters } from '../../src/main/services/library/chapter-parser'
export { parsePasswordText } from '../../src/main/services/library/password-text-parser'
export { pinyinFirstLetter } from '../../src/main/services/library/pinyin-util'

// 共享 Markdown 解析器：桌面端把 AST 渲染成 HTML，手机端渲染成 RN 组件，
// 同一份 AST 保证两端语法表现一致（不引任何 Markdown 库）
export { escapeHtml, parseInline, parseMarkdown } from '../../src/shared/markdown'
export type { MdBlock, MdInline } from '../../src/shared/markdown'

// 笔记搜索：两端同一套匹配与排序规则
export { searchNotes } from '../../src/shared/notes-search'
export type { NoteSearchHit } from '../../src/shared/notes-search'

// 阅读统计的日期逻辑：两端同一套「今天」「最近 N 天」「区间合计」算法
export { buildStatsRange, isDateKey, resolveStatsRange, shiftDate, todayKey } from '../../src/shared/reading-stats'
export type { StatsRangeInput } from '../../src/shared/reading-stats'

// 对话历史裁剪：两端同一套「按轮保留最近若干轮」规则
export { trimHistory, trimmedHistoryNotice } from '../../src/shared/history'
export type { TrimHistoryResult } from '../../src/shared/history'

// 占位封面：两端同一套色板与首字规则
export { coverInitial, coverPalette } from '../../src/shared/book-cover'
export type { CoverPalette } from '../../src/shared/book-cover'

// 模型清单：两端同一套「勾选哪些模型就显示哪些」的规则
export {
  applyModelToggle,
  normalizeModelList,
  resolveChatModels
} from '../../src/shared/model-list'
export { MAX_MODEL_NAME_CHARS, MAX_SELECTED_MODELS } from '../../src/shared/model-list'

// 无会话 AI 流的结构化预览；只复用无平台依赖的纯逻辑。
export { JsonArrayObjectStream, passwordPreview } from '../../src/shared/ai-output'
export type { PasswordAiPreview } from '../../src/shared/types'
