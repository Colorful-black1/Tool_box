/**
 * 分页与定位的纯计算（手机端阅读器）。
 *
 * 为什么不做「测量后切页」：那要先渲染一屏、用 onLayout 量出真实行高、
 * 再二分查找切点，逻辑碎且每次字号 / 旋转屏幕都要重算，异步竞态多。
 * 这里按「字宽 ≈ 字号、行高 = 字号 × 行距」估算每页容量，误差只影响
 * 页面尾部的留白多少，不影响可读性，也不会有跳页 / 死循环。
 *
 * 全部按**码点**而不是 UTF-16 码元切分：emoji 与部分生僻字是代理对，
 * 按码元切会把一个字劈成两半，渲染出「半个字」。
 *
 * 本文件不 import 任何原生模块，可在 vitest 里直接测。
 */

/** CJK 字形宽度约等于字号；拉丁字母窄，这里偏保守，宁可多切几页也不要溢出 */
const CJK_WIDTH_RATIO = 1

export interface PageCapacityInput {
  fontSize: number
  lineSpacing: number
  /** 可用正文宽度（已扣掉左右内边距） */
  width: number
  /** 可用正文高度（已扣掉上下内边距） */
  height: number
}

/** 估算一页能放多少字；结果夹在合理区间内，避免极端窗口尺寸算出 0 或上万 */
export function estimatePageChars(input: PageCapacityInput): number {
  const charWidth = Math.max(1, input.fontSize * CJK_WIDTH_RATIO)
  const lineHeight = Math.max(1, input.fontSize * input.lineSpacing)

  const charsPerLine = Math.floor(input.width / charWidth)
  const linesPerPage = Math.floor(input.height / lineHeight)
  // 不在这里提前 return：窗口极窄时 charsPerLine 会是 0 甚至负数，
  // 提前返回会绕掉下面的下限钳制，把「每页 1 个字」这种退化值放出去。
  // 交给 clamp 统一处理。
  return Math.min(4000, Math.max(120, charsPerLine * linesPerPage))
}

/**
 * 把章节正文切成若干页。
 *
 * 规则：按自然段（换行）累积，尽量不在段落中间断开；
 * 单段本身超过一页容量时才被迫切开（否则会出现一页放不下的空白）。
 * 末尾的空段不产生空白页。
 */
export function paginateText(text: string, pageChars: number): string[] {
  const limit = Math.max(1, Math.floor(pageChars))
  const normalized = text.replace(/\r\n/g, '\n').trim()
  if (!normalized) return ['']

  const pages: string[] = []
  let current = ''

  for (const paragraph of normalized.split('\n')) {
    // 超长段落按容量硬切，否则整页被它顶穿
    for (const chunk of chunkByLength(paragraph, limit)) {
      const separator = current ? 1 : 0
      if (current && current.length + separator + chunk.length > limit) {
        pages.push(current)
        current = chunk
        continue
      }
      current = current ? `${current}\n${chunk}` : chunk
    }
  }

  if (current) pages.push(current)
  return pages.length > 0 ? pages : ['']
}

/** 按码点把一段切成不超过 limit 的块 */
function chunkByLength(text: string, limit: number): string[] {
  if (!text) return ['']
  const chars = Array.from(text)
  if (chars.length <= limit) return [text]

  const chunks: string[] = []
  for (let index = 0; index < chars.length; index += limit) {
    chunks.push(chars.slice(index, index + limit).join(''))
  }
  return chunks
}

/** 进度百分比（0~1）→ 页码下标 */
export function percentToPage(percent: number, pageCount: number): number {
  if (pageCount <= 1) return 0
  const clamped = Math.min(1, Math.max(0, percent))
  return clampPageIndex(Math.floor(clamped * pageCount), pageCount)
}

/** 页码下标 → 进度百分比（0~1）；单页时返回 0，表示「本章还没读」而不是「读完了」 */
export function pageToPercent(pageIndex: number, pageCount: number): number {
  if (pageCount <= 1) return 0
  return Math.min(1, Math.max(0, pageIndex / (pageCount - 1)))
}

export function clampPageIndex(index: number, pageCount: number): number {
  if (pageCount <= 0) return 0
  return Math.min(pageCount - 1, Math.max(0, Math.floor(index)))
}

/** 书签 / 进度条用的正文片段 */
export function textSnippet(text: string, maxChars = 60): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (flat.length <= maxChars) return flat
  return `${Array.from(flat).slice(0, maxChars).join('')}…`
}
