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
