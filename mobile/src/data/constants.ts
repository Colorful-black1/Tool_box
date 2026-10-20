/** 手机端与桌面端共用的文件名常量（值与 shared/constants.ts 保持一致） */

/** 数据��文件名，与桌面端 toolbox.db 同名，便于将来互导 */
export const DB_FILE_NAME = 'toolbox.db'

/** AI 配置（多档案）落盘文件名 */
export const SETTINGS_FILE_NAME = 'ai-settings.json'

/** 封面 / 背景图存放目录（与数据库同级的子目录） */
export const COVERS_DIR = 'covers'
export const BACKGROUNDS_DIR = 'backgrounds'

/** 密码箱主密钥在 SecureStore 中的键名 */
export const MASTER_KEY_STORE_KEY = 'password-master-key'

/**
 * AI 配置（API Key）在 SecureStore 中的键名。
 * 与密码箱主密钥分开：密码箱密钥丢失会让密码永久不可解，
 * 不应让 AI 配置的生命周期牵连它。
 */
export const AI_SETTINGS_MASTER_KEY = 'ai-settings-key'

/** AI 对话相关限制，与 shared/constants.ts 对齐 */
export const CHAT_TIMEOUT_MS = 120_000
export const MAX_INPUT_CHARS = 60_000
export const CONVERSATION_TITLE_MAX_CHARS = 20
export const DEFAULT_CONVERSATION_TITLE = '新对话'

/** 单次请求携带的历史对话字符预算（与 shared/constants.ts 对齐） */
export const MAX_HISTORY_CHARS = 8_000

export const PSEUDO_SPLIT_SIZE = 50_000
export const READER_PADDING_V = 44
export const READER_PADDING_H = 20
export const STATS_FLUSH_TICKS = 30