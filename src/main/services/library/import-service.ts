import { readFileSync } from 'node:fs'

import { parseChapters } from './chapter-parser'
import { decodeText } from './encoding'

export interface ParsedChapterMeta {
  idx: number
  title: string
  body: string
}

export interface ParsedBook {
  title: string
  text: string
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
    const parsedChapters = parseChapters(text)

    const chapters: ParsedChapterMeta[] =
      parsedChapters.length > 0
        ? parsedChapters.map((chapter) => ({
            idx: chapter.idx,
            title: chapter.title,
            body: text.slice(chapter.start, chapter.end).trim()
          }))
        : [{ idx: 0, title: '正文', body: text }]

    return {
      title: extractFileName(filePath),
      text,
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
