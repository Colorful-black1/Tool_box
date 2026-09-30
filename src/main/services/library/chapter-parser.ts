export interface ParsedChapter {
  idx: number
  title: string
  start: number
  end: number
}

const CHAPTER_RE =
  /^[ \t]{0,8}(?:第[0-9〇零一二两三四五六七八九十百千万]{1,15}[章节卷回][^\n]{0,60}|序章|楔子|引子|尾声|终章|后记)[ \t]*$/gm

const PSEUDO_SPLIT_SIZE = 50_000
const TINY_BODY_CHARS = 12

export function parseChapters(text: string): ParsedChapter[] {
  const normalized = text.replace(/\r\n/g, '\n')
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
