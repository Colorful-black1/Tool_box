export const APP_NAME = 'Tool_box'
export const APP_SUBTITLE = 'AI COMPANION · LOCAL FIRST'
export const DB_FILE_NAME = 'toolbox.db'
export const SETTINGS_FILE_NAME = 'ai-settings.json'
export const TRENDING_CACHE_FILE_NAME = 'github-trending-cache.json'
export const AI_WORLD_CACHE_FILE_NAME = 'ai-model-world-cache.json'
export const MASTER_KEY_FILE = 'password-master-key.json'
export const COVERS_DIR = 'covers'
export const BACKGROUNDS_DIR = 'backgrounds'

export const CHAT_TIMEOUT_MS = 120_000
export const MAX_INPUT_CHARS = 60_000
export const CONVERSATION_TITLE_MAX_CHARS = 20
export const DEFAULT_CONVERSATION_TITLE = '新对话'

/**
 * 单次请求携带的历史对话字符预算。
 *
 * 两端此前都把整段历史原样发给模型，聊久了必然撑爆上下文。
 * 超出预算时按「轮」丢弃最早的部分（只裁剪、不摘要），
 * 见 `shared/history.ts`。
 */
export const MAX_HISTORY_CHARS = 8_000

export const PSEUDO_SPLIT_SIZE = 50_000
export const READER_PADDING_V = 44
export const READER_PADDING_H = 20
export const STATS_FLUSH_TICKS = 30

export const SYNC_PORT = 9876
export const SYNC_PAIR_TTL_MS = 300_000
export const SYNC_IPC = {
  serverStart: 'sync:server:start',
  serverStop: 'sync:server:stop',
  serverStatus: 'sync:server:status',
  clientPair: 'sync:client:pair',
  clientSync: 'sync:client:sync'
} as const

export const WINDOW_IPC = {
  bossKey: 'window:boss-key',
  windowInfo: 'window:info',
  setPinned: 'window:set-pinned',
  setBlurOnFocusLost: 'window:blur-on-focus-lost'
} as const