/**
 * 阅读偏好：落盘在既有 kv 表的 `read_config` 键里（`store.configGet/configSet`），
 * 与桌面端 `ReadConfig` 同键同形，读写路径完全一致。
 *
 * 手机端只取阅读真正用得到的子集 —— 桌面那份还有伪装皮肤、老板键、启动锁、
 * 应用背景图等字段，那些在手机端没有对应实现，既不读也不写，
 * 避免两端在同一份 JSON 上互相覆盖时把对方的字段冲掉。
 *
 * 收窄（clamp）是必须的：kv 里的值可能来自旧版本、可能被手工改坏，
 * 字号一旦是 0 或负数会直接让阅读器渲染出空白页。
 */
import { DEFAULT_READ_CONFIG, READER_THEMES, effectiveReaderTheme } from '../shared-bridge'
import type { PageMode, ReaderTheme } from '../shared-bridge'

/**
 * 手机端支持的翻页方式。
 * 桌面端的 `'cover'`（书页覆盖层）依赖图片层与手势层，手机端暂不实现，
 * 读到该值时归一到 `'horizontal'`，避免出现「设置里选不出、行为又对不上」的中间态。
 */
export const MOBILE_PAGE_MODES: PageMode[] = ['scroll', 'horizontal']

export const PAGE_MODE_LABELS: Record<PageMode, string> = {
  scroll: '上下滚动',
  horizontal: '左右翻页',
  cover: '覆盖翻页'
}

export interface ReaderPrefs {
  fontSize: number
  lineSpacing: number
  /** 对应 FONT_OPTIONS 的 value，空串表示跟随系统 */
  fontFamily: string
  /** READER_THEMES 的下标 */
  themeIndex: number
  nightMode: boolean
  pageMode: PageMode
}

export const FONT_SIZE_MIN = 14
export const FONT_SIZE_MAX = 30
export const LINE_SPACING_MIN = 1.2
export const LINE_SPACING_MAX = 2.4

/** 直接从桌面端默认值派生，避免两处默认值漂移 */
export const DEFAULT_READER_PREFS: ReaderPrefs = {
  fontSize: DEFAULT_READ_CONFIG.fontSize,
  lineSpacing: DEFAULT_READ_CONFIG.lineSpacing,
  fontFamily: DEFAULT_READ_CONFIG.fontFamily,
  themeIndex: DEFAULT_READ_CONFIG.themeIndex,
  nightMode: DEFAULT_READ_CONFIG.nightMode,
  pageMode: DEFAULT_READ_CONFIG.pageMode
}

/** 把 kv 里的原始值收窄成安全的阅读偏好 */
export function toReaderPrefs(raw: Record<string, unknown> | null): ReaderPrefs {
  if (!raw) return { ...DEFAULT_READER_PREFS }
  return {
    fontSize: clampNumber(raw['fontSize'], FONT_SIZE_MIN, FONT_SIZE_MAX, DEFAULT_READER_PREFS.fontSize),
    lineSpacing: clampNumber(
      raw['lineSpacing'],
      LINE_SPACING_MIN,
      LINE_SPACING_MAX,
      DEFAULT_READER_PREFS.lineSpacing
    ),
    fontFamily: typeof raw['fontFamily'] === 'string' ? raw['fontFamily'] : DEFAULT_READER_PREFS.fontFamily,
    themeIndex: clampNumber(raw['themeIndex'], 0, READER_THEMES.length - 1, DEFAULT_READER_PREFS.themeIndex),
    nightMode: typeof raw['nightMode'] === 'boolean' ? raw['nightMode'] : DEFAULT_READER_PREFS.nightMode,
    pageMode: toPageMode(raw['pageMode'])
  }
}

function toPageMode(value: unknown): PageMode {
  if (value === 'scroll' || value === 'horizontal') return value
  // 'cover' 与非法值都归一到左右翻页（横向分页在手机端是默认体验）
  if (value === 'cover') return 'horizontal'
  return DEFAULT_READER_PREFS.pageMode === 'cover' ? 'horizontal' : DEFAULT_READER_PREFS.pageMode
}

/**
 * 解析当前生效的阅读主题。
 *
 * 桌面端 `effectiveReaderTheme` 的入参是完整 `ReadConfig`，而手机端只持久化
 * 阅读用得到的子集。这里用桌面端默认值补齐其余字段后再算 ——
 * 比在手机端复制一份 `effectiveReaderTheme` 更好：主题判定规则（夜间模式优先
 * 于主题下标、越界回退米黄）只有一份实现。
 */
export function themeOf(prefs: ReaderPrefs): ReaderTheme {
  return effectiveReaderTheme({ ...DEFAULT_READ_CONFIG, ...prefs })
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, value))
}
