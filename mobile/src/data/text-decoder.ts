/**
 * 书籍 / 文本文件的字节流解码（手机端）。
 *
 * 为什么不能直接复用桌面端 `src/main/services/library/encoding.ts`：
 * 那个函数签名是 `decodeText(bytes: Buffer)`，且 GBK 分支依赖 Node 的
 * `TextDecoder('gbk')`（需要完整 ICU）。手机端 Hermes 既没有 Buffer，
 * `TextDecoder` 也只可靠支持 UTF-8 —— 传 `'utf-16le'` / `{ fatal: true }`
 * 在真机上不一定被支持。因此这里手写纯逻辑，只覆盖能在手机端可靠解码的编码。
 *
 * 覆盖范围（与用户的取舍一致）：
 * - UTF-8（含 BOM）
 * - UTF-16 LE / BE（含 BOM）
 * - GBK / ANSI：**明确报错**，提示先转存为 UTF-8。
 *   静默按 latin1 或 UTF-8 兜底会产生满屏乱码，比报错更难排查。
 *
 * 本文件不 import 任何原生模块，全部是纯函数，可在 vitest 里直接测。
 */

/** 手机端可可靠解码的编码 */
export type TextEncoding = 'UTF-8' | 'UTF-16LE' | 'UTF-16BE'

export interface DecodedText {
  text: string
  encoding: TextEncoding
}

/**
 * 不支持的编码（目前只有 GBK / ANSI 一类）。
 * 单独一个错误类型，便于界面精确提示「这是编码问题」而不是笼统的读取失败。
 */
export class UnsupportedTextEncodingError extends Error {
  constructor() {
    super('该文件不是 UTF-8 或 UTF-16 编码（可能是 GBK / ANSI），请先用文本编辑器转存为 UTF-8 后再导入')
    this.name = 'UnsupportedTextEncodingError'
  }
}

/**
 * 单个文件的体积上限：32MB。
 *
 * 为什么留上限而不彻底删掉：手机端整条链路都在 Hermes 堆里，一次导入的峰值
 * 大约是文件体积的 2.3 倍（字节流 + 解码后的全文 + 章节副本）。不设限的话，
 * 超大文件会直接被系统 OOM killer 杀掉进程，用户看到的是「闪退」而不是报错，
 * 反而更难排查。桌面端没有这个限制 —— 它在 Node 主进程里，且书籍正文入库后即释放。
 *
 * 从 12MB 放宽到 32MB：足以覆盖绝大多数单本网络小说（百万字 UTF-8 约 3MB），
 * 也留出了「多本合集」的空间，同时仍远低于 OOM 阈值。
 */
export const MAX_BOOK_BYTES = 32 * 1024 * 1024

const UTF8_BOM = [0xef, 0xbb, 0xbf] as const
const UTF16LE_BOM = [0xff, 0xfe] as const
const UTF16BE_BOM = [0xfe, 0xff] as const

/** UTF-16 探测的取样字节数：只看开头足够判断，也不浪费时间扫全文 */
const UTF16_SNIFF_BYTES = 256

/**
 * 体积超限的用户提示。
 *
 * 导出是因为调用方需要在**读进内存之前**就拦一次：`File.size` 是同步可读的，
 * 而 `decodeBookText` 要等 `arrayBuffer()` 整个读完才发现超限 —— 32MB 的
 * 白读一趟在真机上既慢又占内存。两处共用同一句文案，免得用户看到两种说法。
 */
export function formatSizeError(size: number): string {
  const limit = Math.round(MAX_BOOK_BYTES / 1024 / 1024)
  return `文件 ${formatMegabytes(size)} 超过 ${limit}MB 上限，请拆分后再导入`
}

export function decodeBookText(bytes: Uint8Array): DecodedText {
  if (bytes.length > MAX_BOOK_BYTES) throw new Error(formatSizeError(bytes.length))

  const bom = detectBom(bytes)
  if (bom) {
    return { text: decodeWith(bom.encoding, bytes.subarray(bom.length)), encoding: bom.encoding }
  }

  // 无 BOM 时先看是不是 UTF-16：纯 ASCII 的 UTF-16 文本里每两个字节必有一个 0x00
  const sniffed = looksLikeUtf16(bytes)
  if (sniffed) {
    return { text: decodeWith(sniffed, bytes), encoding: sniffed }
  }

  if (!isValidUtf8(bytes)) throw new UnsupportedTextEncodingError()
  return { text: decodeWith('UTF-8', bytes), encoding: 'UTF-8' }
}

/** 解码已判定编码的字节流；UTF-16 走手写实现，不依赖 TextDecoder 的编码标签 */
function decodeWith(encoding: TextEncoding, bytes: Uint8Array): string {
  if (encoding === 'UTF-8') return decodeUtf8(bytes)
  return decodeUtf16(bytes, encoding === 'UTF-16LE')
}

/**
 * UTF-8 解码只借 TextDecoder 的 utf-8 分支 —— 这条路径是手机端已在用的
 * （`sse.ts` 增量解码就靠它），可以信任。
 */
function decodeUtf8(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8').decode(bytes)
  } catch {
    throw new UnsupportedTextEncodingError()
  }
}

/**
 * 手写 UTF-16 解码。
 *
 * 不用 `TextDecoder('utf-16le')`：Hermes 的 TextDecoder 不保证支持该编码标签，
 * 传了可能静默按 UTF-8 处理或抛错。这里显式按字节序拼 code unit，
 * 顺带把落单的代理项替换成 U+FFFD，避免出现「看不见的字符」。
 */
export function decodeUtf16(bytes: Uint8Array, littleEndian: boolean): string {
  const units: number[] = []
  for (let index = 0; index + 1 < bytes.length; index += 2) {
    const low = bytes[index]
    const high = bytes[index + 1]
    units.push(littleEndian ? low | (high << 8) : (low << 8) | high)
  }

  let text = ''
  for (let index = 0; index < units.length; index += 1) {
    const unit = units[index]
    const isHighSurrogate = unit >= 0xd800 && unit <= 0xdbff
    const isLowSurrogate = unit >= 0xdc00 && unit <= 0xdfff

    if (isHighSurrogate) {
      const next = units[index + 1]
      if (next !== undefined && next >= 0xdc00 && next <= 0xdfff) {
        // 合法代理对：两个 code unit 直接相邻即可拼成原字符
        text += String.fromCharCode(unit, next)
        index += 1
      } else {
        text += '\ufffd'
      }
      continue
    }
    text += isLowSurrogate ? '\ufffd' : String.fromCharCode(unit)
  }
  return text
}

export interface BomInfo {
  encoding: TextEncoding
  /** BOM 字节数，调用方需从字节流里剥掉 */
  length: number
}

export function detectBom(bytes: Uint8Array): BomInfo | null {
  if (startsWith(bytes, UTF8_BOM)) return { encoding: 'UTF-8', length: UTF8_BOM.length }
  if (startsWith(bytes, UTF16LE_BOM)) return { encoding: 'UTF-16LE', length: UTF16LE_BOM.length }
  if (startsWith(bytes, UTF16BE_BOM)) return { encoding: 'UTF-16BE', length: UTF16BE_BOM.length }
  return null
}

/**
 * 无 BOM 的 UTF-16 探测：统计取样区间内奇数位 / 偶数位上的 0x00 数量。
 *
 * ASCII 文本的 UTF-16LE 形如 `h\0e\0l\0l\0o\0`（0x00 在奇数位），
 * UTF-16BE 则是 `\0h\0e\0l\0l\0o`（0x00 在偶数位）。
 * 要求 NUL 占比够高（>= 25%）且至少 4 个，避免把含少量控制字符的
 * 普通二进制 / UTF-8 文件误判成 UTF-16。
 */
export function looksLikeUtf16(bytes: Uint8Array): TextEncoding | null {
  const limit = Math.min(bytes.length, UTF16_SNIFF_BYTES)
  if (limit < 8) return null

  let nullAtEven = 0
  let nullAtOdd = 0
  for (let index = 0; index < limit; index += 1) {
    if (bytes[index] !== 0) continue
    if (index % 2 === 0) nullAtEven += 1
    else nullAtOdd += 1
  }

  const threshold = Math.max(4, Math.floor(limit * 0.25))
  if (nullAtOdd >= threshold && nullAtOdd > nullAtEven) return 'UTF-16LE'
  if (nullAtEven >= threshold && nullAtEven > nullAtOdd) return 'UTF-16BE'
  return null
}

/**
 * 严格的 UTF-8 字节流校验。
 *
 * 不用 `TextDecoder('utf-8', { fatal: true })`：Hermes 不保证支持 `fatal` 选项，
 * 非法的 GBK 字节可能被静默替换成 U+FFFD 而不抛错，那样就永远走不到
 * 「明确提示转存 UTF-8」这个分支。宁可自己按码点规则判一遍。
 *
 * 判定表按 Unicode 标准的 well-formed byte sequence：
 * 过长的编码（C0/C1）、代理区码点（ED A0..BF）、超出 U+10FFFF 的（F5..FF）
 * 一律判为非法 —— 这正是 GBK 文本最常见的形态。
 */
export function isValidUtf8(bytes: Uint8Array): boolean {
  let index = 0
  while (index < bytes.length) {
    const byte = bytes[index]

    if (byte <= 0x7f) {
      index += 1
      continue
    }
    if (byte >= 0xc2 && byte <= 0xdf) {
      if (!isContinuation(bytes, index + 1)) return false
      index += 2
      continue
    }
    if (byte === 0xe0) {
      if (!inRange(bytes, index + 1, 0xa0, 0xbf) || !isContinuation(bytes, index + 2)) return false
      index += 3
      continue
    }
    if (byte >= 0xe1 && byte <= 0xec) {
      if (!isContinuation(bytes, index + 1) || !isContinuation(bytes, index + 2)) return false
      index += 3
      continue
    }
    if (byte === 0xed) {
      // 排除 UTF-16 代理区码点 U+D800..U+DFFF
      if (!inRange(bytes, index + 1, 0x80, 0x9f) || !isContinuation(bytes, index + 2)) return false
      index += 3
      continue
    }
    if (byte === 0xee || byte === 0xef) {
      if (!isContinuation(bytes, index + 1) || !isContinuation(bytes, index + 2)) return false
      index += 3
      continue
    }
    if (byte === 0xf0) {
      if (!inRange(bytes, index + 1, 0x90, 0xbf)) return false
      if (!isContinuation(bytes, index + 2) || !isContinuation(bytes, index + 3)) return false
      index += 4
      continue
    }
    if (byte >= 0xf1 && byte <= 0xf3) {
      if (!isContinuation(bytes, index + 1)) return false
      if (!isContinuation(bytes, index + 2) || !isContinuation(bytes, index + 3)) return false
      index += 4
      continue
    }
    if (byte === 0xf4) {
      // 上限 U+10FFFF
      if (!inRange(bytes, index + 1, 0x80, 0x8f)) return false
      if (!isContinuation(bytes, index + 2) || !isContinuation(bytes, index + 3)) return false
      index += 4
      continue
    }
    // 0x80..0xC1 续字节 / 过长编码，0xF5..0xFF 超范围
    return false
  }
  return true
}

function isContinuation(bytes: Uint8Array, index: number): boolean {
  return index < bytes.length && bytes[index] >= 0x80 && bytes[index] <= 0xbf
}

function inRange(bytes: Uint8Array, index: number, min: number, max: number): boolean {
  return index < bytes.length && bytes[index] >= min && bytes[index] <= max
}

function startsWith(bytes: Uint8Array, prefix: readonly number[]): boolean {
  if (bytes.length < prefix.length) return false
  return prefix.every((byte, index) => bytes[index] === byte)
}

/** 字节数 → 人类可读体积；小于 1MB 时给 KB，避免 0MB 这种没信息量的提示 */
function formatMegabytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))}KB`
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`
}
