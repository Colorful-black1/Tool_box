export interface ParsedChapter {
  idx: number
  title: string
  start: number
  end: number
}

/**
 * 章节标题正则，与旧项目 lib/core/chapter_parser.dart 保持一致：
 * - 第\s*[0-9零一二三四五六七八九十百千万两]+\s*[章节卷回部集]，允许数字前后有空格
 * - 数字支持阿拉伯数字与中文数字混排
 * - 允许标题后跟不超过 40 字的副标题
 * - 单独成行（前后可有空白）
 */
const CHAPTER_RE =
  /^[ \t]*(?:第\s*[0-9零〇一壹二贰两三叁四肆五伍六陆七柒八捌九玖十百千万萬]+[ \t]*[章节卷回部集][^\n]{0,40}|序章|楔子|引子|尾声|终章|后记)[ \t]*$/gm

const PSEUDO_SPLIT_SIZE = 50_000
const TINY_BODY_CHARS = 12

/**
 * 章节切分前必须先把 CRLF 归一，且**必须用归一后的那一份文本去按区间取正文**。
 *
 * `parseChapters` 返回的 `start` / `end` 是归一后文本里的字符下标。调用方若拿它
 * 去切原文（仍是 `\r\n` 的那一份），每章正文会按前面累计的 `\r` 数量整体错位：
 * Windows 记事本默认就存 CRLF，所以这不是边缘情况。实测两章的 TXT 里，
 * 第二章正文会吞掉标题尾部（「…转折」）并被截掉尾巴。
 *
 * 导出它就是为了让调用方与 `parseChapters` 共用同一份字符串，从而对上偏移。
 * 只处理 `\r\n` → `\n`，不碰单独的 `\r`（老 Mac 换行已绝迹）。
 */
export function normalizeChapterText(text: string): string {
  // 没有 CRLF 就原样返回：大文件下少一份全文副本很关键（手机端一次导入可达数十 MB）
  return text.includes('\r\n') ? text.replace(/\r\n/g, '\n') : text
}

export function parseChapters(text: string): ParsedChapter[] {
  const normalized = normalizeChapterText(text)
  if (!normalized.trim()) return []

  const marks = Array.from(normalized.matchAll(CHAPTER_RE)).map((match) => ({
    title: cleanTitle(match[0]),
    titleStart: match.index,
    bodyStart: match.index + match[0].length
  }))

  if (marks.length === 0) return pseudoChapters(normalized)

  // 正文出现在第一个章节标题之前 → 作为「开篇」保留
  const first = marks[0]
  if (first.titleStart > 0 && normalized.slice(0, first.titleStart).trim().length > 0) {
    marks.unshift({ title: '开篇', titleStart: 0, bodyStart: 0 })
  }

  const chapters: ParsedChapter[] = marks.map((mark, i) => ({
    idx: 0,
    title: mark.title,
    start: mark.bodyStart,
    end: i + 1 < marks.length ? marks[i + 1].titleStart : normalized.length
  }))
  chapters.forEach((chapter, idx) => {
    chapter.idx = idx
  })

  return mergeTinyChapters(chapters, normalized)
}

function mergeTinyChapters(chapters: ParsedChapter[], text: string): ParsedChapter[] {
  const result = [...chapters]
  for (let i = result.length - 1; i > 0; i -= 1) {
    const body = text.slice(result[i].start, result[i].end).trim()
    if (body.length < TINY_BODY_CHARS && result[i].title !== '开篇') {
      result[i - 1].end = result[i].end
      result.splice(i, 1)
    }
  }
  return result.map((chapter, idx) => ({ ...chapter, idx }))
}

function pseudoChapters(text: string): ParsedChapter[] {
  if (text.length <= PSEUDO_SPLIT_SIZE) {
    return [{ idx: 0, title: '全文', start: 0, end: text.length }]
  }

  const chapters: ParsedChapter[] = []
  let start = 0
  while (start < text.length) {
    let end = Math.min(start + PSEUDO_SPLIT_SIZE, text.length)
    if (end < text.length) {
      const window = text.slice(start, Math.min(end + 2000, text.length))
      const boundary = Math.max(
        window.lastIndexOf('\n', PSEUDO_SPLIT_SIZE + 2000),
        window.lastIndexOf('。'),
        window.lastIndexOf('！'),
        window.lastIndexOf('？')
      )
      if (boundary > PSEUDO_SPLIT_SIZE * 0.5) end = start + boundary + 1
    }
    chapters.push({
      idx: chapters.length,
      title: `第 ${chapters.length + 1} 段`,
      start,
      end
    })
    start = end
  }
  return chapters
}

function cleanTitle(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim()
}
