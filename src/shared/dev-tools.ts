/**
 * 开发者小工具的纯逻辑：桌面端与手机端共用。
 *
 * 设计原则：**不引任何依赖，也不依赖浏览器专有 API**。
 * Base64 用手写实现（而不是 `btoa` / `atob`）——Hermes 上那两个全局函数
 * 已被 RN 标记废弃，自己实现两端的行為就一致了。
 *
 * 所有函数都遵守两条约定：
 * - 输入非法时**抛错**（抛可读的中文 Error），由界面负责转成提示；
 * - 不做任何 I/O，纯字符串计算，便于单测。
 */

/** Base64 字母表 */
const BASE64_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** 正则匹配结果最多返回多少条，避免超长文本把界面撑爆 */
const MAX_REGEX_MATCHES = 200

// ==================== Base64 ====================

/** 字符串 → UTF-8 字节数组 */
function utf8Bytes(text: string): number[] {
  const out: number[] = []
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0
    if (code > 0xffff) {
      // 四字节（emoji 等）：按原始码点取 3 / 6 / 6 / 6 位
      out.push(
        0xf0 | ((code >> 18) & 0x07),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f)
      )
      continue
    }
    if (code < 0x80) {
      out.push(code)
      continue
    }
    if (code < 0x800) {
      out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f))
      continue
    }
    out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f))
  }
  return out
}

/** UTF-8 字节数组 → 字符串 */
function utf8String(bytes: number[]): string {
  let out = ''
  let i = 0
  while (i < bytes.length) {
    const byte = bytes[i++]
    if (byte < 0x80) {
      out += String.fromCharCode(byte)
      continue
    }
    if (byte >= 0xc0 && byte < 0xe0) {
      out += String.fromCharCode(((byte & 0x1f) << 6) | (bytes[i++] & 0x3f))
      continue
    }
    if (byte >= 0xe0 && byte < 0xf0) {
      out += String.fromCharCode(
        ((byte & 0x0f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f)
      )
      continue
    }
    const code =
      ((byte & 0x07) << 18) |
      ((bytes[i++] & 0x3f) << 12) |
      ((bytes[i++] & 0x3f) << 6) |
      (bytes[i++] & 0x3f)
    out += String.fromCodePoint(code)
  }
  return out
}

/** Base64 编码（UTF-8 语义，中文不会乱码） */
export function encodeBase64(text: string): string {
  const bytes = utf8Bytes(text)
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]
    const b1 = bytes[i + 1]
    const b2 = bytes[i + 2]
    out += BASE64_ALPHABET[b0 >> 2]
    out += BASE64_ALPHABET[((b0 & 0x03) << 4) | ((b1 ?? 0) >> 4)]
    out += b1 === undefined ? '=' : BASE64_ALPHABET[((b1 & 0x0f) << 2) | ((b2 ?? 0) >> 6)]
    out += b2 === undefined ? '=' : BASE64_ALPHABET[b2 & 0x3f]
  }
  return out
}

/** Base64 解码（容忍空白与 URL 安全变体 `-` / `_`） */
export function decodeBase64(text: string): string {
  const clean = text.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/')
  if (!clean) return ''
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(clean)) {
    throw new Error('不是合法的 Base64 文本')
  }
  const body = clean.replace(/=+$/, '')
  const bytes: number[] = []
  let buffer = 0
  let bits = 0
  for (const char of body) {
    const value = BASE64_ALPHABET.indexOf(char)
    if (value < 0) throw new Error('不是合法的 Base64 文本')
    buffer = (buffer << 6) | value
    bits += 6
    if (bits >= 8) {
      bits -= 8
      bytes.push((buffer >> bits) & 0xff)
    }
  }
  return utf8String(bytes)
}

// ==================== URL 编解码 ====================

/** URL 百分号编码 */
export function encodeUrl(text: string): string {
  return encodeURIComponent(text)
}

/** URL 百分号解码（非法转义会抛错） */
export function decodeUrl(text: string): string {
  try {
    return decodeURIComponent(text)
  } catch {
    throw new Error('不是合法的 URL 编码文本（含有无效的 % 转义）')
  }
}

// ==================== 时间戳 ====================

/** 时间戳 → 本地时间字符串（YYYY-MM-DD HH:mm:ss） */
export function formatTimestamp(ms: number): string {
  if (!Number.isFinite(ms)) throw new Error('时间戳无效')
  const date = new Date(ms)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  )
}

/**
 * 时间戳字符串 → 毫秒数。
 *
 * 兼容三种写法：10 位秒、13 位毫秒、以及纯数字串。
 * 非纯数字返回 null（界面上提示「不是时间戳」）。
 */
export function parseTimestamp(input: string): number | null {
  const trimmed = input.trim()
  if (!/^\d+$/.test(trimmed)) return null
  const value = Number(trimmed)
  if (!Number.isSafeInteger(value)) return null
  // 10 位当秒、13 位当毫秒；其余位数按毫秒处理
  return trimmed.length <= 10 ? value * 1000 : value
}

/** 日期字符串（YYYY-MM-DD[ HH:mm[:ss]]）→ 毫秒数，非法返回 null */
export function parseDateTime(input: string): number | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(trimmed)
  if (!match) return null
  const [, y, m, d, hh = '0', mm = '0', ss = '0'] = match
  const ms = new Date(
    Number(y),
    Number(m) - 1,
    Number(d),
    Number(hh),
    Number(mm),
    Number(ss)
  ).getTime()
  return Number.isNaN(ms) ? null : ms
}

// ==================== JSON ====================

/** JSON 处理结果（成功必有 output，失败必有 error） */
export type JsonResult =
  | { ok: true; output: string; error?: undefined }
  | { ok: false; output: ''; error: string }

function parseJson(
  text: string
): { ok: true; value: unknown } | { ok: false; output: ''; error: string } {
  const trimmed = text.trim()
  if (!trimmed) return { ok: false, output: '', error: '请输入 JSON 文本' }
  try {
    return { ok: true, value: JSON.parse(trimmed) }
  } catch (error) {
    return {
      ok: false,
      output: '',
      error: error instanceof Error ? error.message : 'JSON 解析失败'
    }
  }
}

/** JSON 格式化（缩进 2 空格） */
export function formatJson(text: string): JsonResult {
  const parsed = parseJson(text)
  if (!parsed.ok) return parsed
  return { ok: true, output: JSON.stringify(parsed.value, null, 2) }
}

/** JSON 压缩（去掉所有空白） */
export function minifyJson(text: string): JsonResult {
  const parsed = parseJson(text)
  if (!parsed.ok) return parsed
  return { ok: true, output: JSON.stringify(parsed.value) }
}

// ==================== 文本统计与行处理 ====================

/** 文本统计结果 */
export interface TextStats {
  /** 字符数（按码点算，中文算 1 个） */
  chars: number
  /** 不含空白字符数 */
  charsNoSpace: number
  /** 行数 */
  lines: number
  /** 词数：中文按字、英文按词 */
  words: number
  /** 段落数（空行分隔） */
  paragraphs: number
}

/** 统计一段文本的字数、行数、词数、段落数 */
export function textStats(text: string): TextStats {
  const chars = [...text].length
  const charsNoSpace = [...text].filter((char) => !/\s/.test(char)).length
  const lines = text.length === 0 ? 0 : text.split(/\r\n|\r|\n/).length
  const cjk = text.match(/[㐀-䶿一-鿿豈-﫿]/g)?.length ?? 0
  const latin = text.match(/[A-Za-z0-9_]+/g)?.length ?? 0
  const paragraphs = text
    .split(/\r\n|\r|\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0).length
  return { chars, charsNoSpace, lines, words: cjk + latin, paragraphs }
}

/** 按行去重（保留首次出现的顺序） */
export function dedupeLines(text: string): string {
  const seen = new Set<string>()
  const out: string[] = []
  for (const line of text.split(/\r\n|\r|\n/)) {
    const key = line.trim()
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(line)
  }
  return out.join('\n')
}

/** 按行排序 */
export function sortLines(text: string, order: 'asc' | 'desc'): string {
  const lines = text.split(/\r\n|\r|\n/)
  const sorted = [...lines].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'))
  return order === 'desc' ? sorted.reverse().join('\n') : sorted.join('\n')
}

/** 去掉每行首尾空白 */
export function trimLines(text: string): string {
  return text
    .split(/\r\n|\r|\n/)
    .map((line) => line.trim())
    .join('\n')
}

// ==================== UUID ====================

/** 单次批量生成的条数上限，防止一次刷爆内存 */
const MAX_UUID_BATCH = 1000

/**
 * 生成一个 UUID v4（RFC 4122）。
 *
 * 用 `crypto.getRandomValues` 取 16 字节随机数，再按规范写入版本号（4）
 * 与变体位。不用 `Math.random` —— UUID 常被当主键或令牌用。
 */
export function generateUuid(): string {
  const crypto = globalThis.crypto
  if (!crypto?.getRandomValues) {
    throw new Error('当前环境不支持安全随机数，无法生成 UUID')
  }
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  // 版本号固定为 4，变体位固定为 10xx（RFC 4122 §4.4）
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20)
  ].join('-')
}

/** 批量生成 UUID；数量收敛到 1 ~ 1000 */
export function generateUuidBatch(count: number): string[] {
  const total = Math.min(MAX_UUID_BATCH, Math.max(1, Math.round(count)))
  const out: string[] = []
  for (let index = 0; index < total; index += 1) out.push(generateUuid())
  return out
}

// ==================== 正则 ====================

/** 一条正则命中 */
export interface RegexMatch {
  /** 在原文中的起始下标 */
  index: number
  /** 命中长度 */
  length: number
  /** 命中文本 */
  text: string
}

/** 正则测试结果 */
export interface RegexResult {
  /** 表达式非法时的原因 */
  error?: string
  matches: RegexMatch[]
}

/**
 * 在文本上跑一次正则，返回命中列表。
 *
 * 每次都新建 RegExp，避免 `g` 标志的 lastIndex 残留导致第二次调用结果为空。
 * 命中数封顶，避免超长文本一次吐几十万条。
 */
export function testRegex(pattern: string, flags: string, text: string): RegexResult {
  if (!pattern) return { matches: [] }
  let regex: RegExp
  try {
    regex = new RegExp(pattern, flags)
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : '正则表达式无效',
      matches: []
    }
  }
  const matches: RegexMatch[] = []
  let guard = 0
  let match = regex.exec(text)
  while (match !== null && matches.length < MAX_REGEX_MATCHES && guard < 100000) {
    guard += 1
    matches.push({ index: match.index, length: match[0].length, text: match[0] })
    // 零宽匹配要手动推进，否则会死循环
    if (match[0].length === 0) regex.lastIndex += 1
    match = regex.exec(text)
  }
  return { matches }
}
