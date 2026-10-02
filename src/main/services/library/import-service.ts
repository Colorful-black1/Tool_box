import { readFileSync } from 'node:fs'

import { normalizeChapterText, parseChapters } from './chapter-parser'
import { decodeText } from './encoding'

export interface ParsedChapterMeta {
  idx: number
  title: string
  body: string
}

export interface ParsedBook {
  title: string
  chapters: ParsedChapterMeta[]
}

/** TXT 导入解析：编码探测 → 章节切分（无章节时按 5 万字伪切分）。 */
export class ImportService {
  parse(filePath: string): ParsedBook {
    const bytes = readFileSync(filePath)
    if (bytes.length === 0) {
      throw new Error('文件为空，无法导入')
    }

    const { text } = decodeText(bytes)
    // parseChapters 返回的偏移是**它自己归一后**那份文本里的下标，
    // 所以切片也必须在归一后的文本上做，否则 CRLF 书籍每章正文都错位。
    const normalized = normalizeChapterText(text)
    const parsedChapters = parseChapters(normalized)

    const chapters: ParsedChapterMeta[] =
      parsedChapters.length > 0
        ? parsedChapters.map((chapter) => ({
            idx: chapter.idx,
            title: chapter.title,
            body: normalized.slice(chapter.start, chapter.end).trim()
          }))
        : [{ idx: 0, title: '正文', body: normalized.trim() }]

    return {
      title: extractFileName(filePath),
      chapters
    }
  }
}

function extractFileName(filePath: string): string {
  const normalized = filePath.replaceAll('\\', '/')
  const fileName = normalized.slice(normalized.lastIndexOf('/') + 1)
  const dot = fileName.lastIndexOf('.')
  return dot > 0 ? fileName.slice(0, dot) : fileName
}
