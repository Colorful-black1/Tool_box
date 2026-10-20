/**
 * 分页引擎（对应旧项目 core/paginator.dart）。
 *
 * 与旧实现的差异：Flutter 用 TextPainter 在无头环境排版，
 * Web 端改为「一次渲染 + 测量可视高度」的方式：
 * - 用一个高度为 auto 的容器渲染整章文本，测出 scrollHeight；
 * - 按可视高度取整得到页数；
 * - 通过 translateY 偏移裁剪出当前页。
 *
 * 优点：与真实渲染结果完全一致（含换行、标点避头尾、字体回退），
 * 不需要重复实现文本排版算法，也不会出现「测量值与渲染值不一致」。
 */
import type { ChapterSearchHit } from '../../../shared/types'

export type { ChapterSearchHit }

export interface PaginationResult {
  pageCount: number
  /** 每页的起始比例（0~1），用于书签 / 搜索结果定位 */
  pageOffsets: number[]
  totalHeight: number
  pageHeight: number
}

export function paginate(
  totalHeight: number,
  pageHeight: number
): PaginationResult {
  if (pageHeight <= 0 || totalHeight <= 0) {
    return { pageCount: 1, pageOffsets: [0], totalHeight, pageHeight }
  }
  const pageCount = Math.max(1, Math.ceil(totalHeight / pageHeight))
  const pageOffsets = Array.from({ length: pageCount }, (_, index) =>
    Math.min(1, (index * pageHeight) / totalHeight)
  )
  return { pageCount, pageOffsets, totalHeight, pageHeight }
}

/** 字符偏移（0~1 比例）→ 页索引：返回「起始偏移 ≤ 比例」中的最后一页 */
export function locate(pageOffsets: number[], ratio: number): number {
  if (pageOffsets.length === 0) return 0
  const clamped = Math.min(1, Math.max(0, ratio))
  let result = 0
  for (let index = 0; index < pageOffsets.length; index += 1) {
    if (pageOffsets[index] > clamped + Number.EPSILON) break
    result = index
  }
  return result
}

/**
 * 全文搜索：返回每章命中位置（字符比例），用于点击跳转。
 * 大小写不敏感，最多返回 maxResults 条。
 */
export interface ChapterSearchInput {
  idx: number
  title: string
  content: string
}

export function searchChapters(
  chapters: ChapterSearchInput[],
  rawQuery: string,
  maxResults = 200
): { hits: ChapterSearchHit[]; truncated: boolean } {
  const query = rawQuery.trim()
  if (!query) return { hits: [], truncated: false }

  const needle = query.toLowerCase()
  const hits: ChapterSearchHit[] = []
  let truncated = false

  for (const chapter of chapters) {
    const haystack = chapter.content
    const lower = haystack.toLowerCase()
    let cursor = 0

    while (cursor < lower.length) {
      const found = lower.indexOf(needle, cursor)
      if (found < 0) break

      if (hits.length >= maxResults) {
        truncated = true
        break
      }

      const before = haystack
        .slice(Math.max(0, found - 20), found)
        .replace(/\s+/g, ' ')
        .trim()
      const match = haystack.slice(found, found + query.length)
      const after = haystack
        .slice(found + query.length, found + query.length + 20)
        .replace(/\s+/g, ' ')
        .trim()

      hits.push({
        chapterIdx: chapter.idx,
        chapterTitle: chapter.title,
        ratio: haystack.length === 0 ? 0 : found / haystack.length,
        before,
        match,
        after
      })

      cursor = found + Math.max(1, needle.length)
    }

    if (truncated) break
  }

  return { hits, truncated }
}