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
  AI_PROVIDER_IDS,
  AI_PROVIDER_PRESETS,
  DEFAULT_READ_CONFIG,
  FONT_OPTIONS,
  NIGHT_THEME,
  READER_THEMES,
  findAiProvider,
  isAiProviderId,
  matchProviderByBaseUrl
} from '../../src/shared/types'
export type {
  AiConfigView,
  AiFetchModelsInput,
  AiModelListResult,
  AiProfileInput,
  AiProfileView,
  AiProviderId,
  AiProviderPreset,
  BackgroundPreset,
  ChapterMeta,
  ChatMessage,
  ConversationSummary,
  NoteView,
  PasswordDraft,
  PasswordEntryView,
  PasswordInput
} from '../../src/shared/types'

// AI 错误映射与端点规范化：与桌面端共用，保证报错文案完全一致
export {
  AiGatewayError,
  describeAiError,
  normalizeOpenAiBaseUrl,
  redactSecret,
  validateChatInput
} from '../../src/main/services/ai-gateway/errors'

// 纯解析器：章节 / 密码文本 / 拼音首字母
export { parseChapters } from '../../src/main/services/library/chapter-parser'
export { parsePasswordText } from '../../src/main/services/library/password-text-parser'
export { pinyinFirstLetter } from '../../src/main/services/library/pinyin-util'
