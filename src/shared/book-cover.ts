/**
 * 无封面书籍的占位封面（两端共用）。
 *
 * 为什么要有：导入的书本来就没有封面，桌面端是一块纯色、手机端干脆没有封面位，
 * 书架看起来像一堆文字。占位封面用「首字 + 主题色」自动生成：
 * 零依赖（不引任何封面 / 渐变库），一眼能认出是哪本。
 *
 * 颜色取自桌面端原有的 `CARD_COLORS`（同一批色相，只压暗了一档以贴合深色底），
 * 另加一个金色变体；两端用同一份色板，桌面端铺 CSS 渐变、
 * 手机端用纯色 + 压暗层近似（RN 没有内置渐变）。
 */

/** 占位封面色板 */
export interface CoverPalette {
  /** 封面底色 */
  base: string
  /** 首字颜色 */
  text: string
}

/** 色板：前五个沿用桌面端旧色相，第六个用主题金 */
const PALETTES: readonly CoverPalette[] = [
  { base: '#4E6580', text: '#cfe0ef' },
  { base: '#6B7A48', text: '#dfe6b8' },
  { base: '#8A5847', text: '#f0c2b2' },
  { base: '#5F5570', text: '#d7cbe6' },
  { base: '#3F6B57', text: '#bfe3d2' },
  { base: '#7A6440', text: '#e8c98a' }
]

/** 字符串哈希：同一本书每次都得到同一个色板 */
function hashOf(value: string): number {
  let hash = 0
  for (const char of value) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return hash
}

/** 按书名或 id 取一个稳定的色板 */
export function coverPalette(seed: string): CoverPalette {
  return PALETTES[hashOf(seed) % PALETTES.length]
}

/**
 * 取封面首字。
 *
 * 中文取第一个字；英文取首字母并大写；空标题给一个占位符，
 * 免得封面位置空着（比空白好看）。
 */
export function coverInitial(title: string): string {
  const trimmed = title.trim()
  if (!trimmed) return '·'
  const first = Array.from(trimmed)[0]
  return /[a-z]/i.test(first) ? first.toUpperCase() : first
}
