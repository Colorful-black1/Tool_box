/**
 * TXT 书籍导入：字节流 → 章节列表（手机端）。
 *
 * 抽出来是为了让「选文件」之外的整条链路都是纯逻辑，能在 vitest 里跑：
 * 编码探测（`text-decoder.ts`）与章节切分（桌面端共享的 `parseChapters`）
 * 都不碰原生模块，只有最后把字节读出来那一步必须在真机。
 *
 * 章节切分复用桌面端 `parseChapters`，注意它返回的是**字符偏移**而不是正文，
 * 这里负责把 body 切出来。注意 `parseChapters` 自己已经带兜底：
 * 一个章节标题都没识别出来时会按 5 万字伪切分成「全文 / 第 N 段」，
 * 所以下面的 `: [{ title: '正文', body }]` 分支实际走不到 ——
 * 它只是与桌面端 `ImportService` 保持同形的防御性分支。
 */
import { parseChapters } from '../shared-bridge'
import { decodeBookText } from './text-decoder'

export interface ImportedChapter {
  title: string
  body: string
}

export interface ImportedBook {
  title: string
  chapters: ImportedChapter[]
}

/** 单本导入的章节数上限：超过多半是把整本合集当一章塞进来了，先拦住免得界面卡死 */
const MAX_CHAPTERS = 5000

export function buildImportedBook(fileName: string, bytes: Uint8Array): ImportedBook {
  if (bytes.length === 0) throw new Error('文件为空，无法导入')

  const { text } = decodeBookText(bytes)
  if (!text.trim()) throw new Error('文件里没有可读文本')

  const parsed = parseChapters(text)
  const chapters: ImportedChapter[] =
    parsed.length > 0
      ? parsed.map((chapter) => ({
          title: chapter.title,
          body: text.slice(chapter.start, chapter.end).trim()
        }))
      : [{ title: '正文', body: text.trim() }]

  if (chapters.length > MAX_CHAPTERS) {
    throw new Error(`识别出 ${chapters.length} 个章节，超过上限，请检查文件是否为多本合集`)
  }

  return { title: extractTitle(fileName), chapters }
}

/** 文件名去掉目录与扩展名，作为书名；用户之后可在阅读页改名 */
export function extractTitle(fileName: string): string {
  const normalized = fileName.replaceAll('\\', '/')
  const base = normalized.slice(normalized.lastIndexOf('/') + 1)
  const dot = base.lastIndexOf('.')
  const title = (dot > 0 ? base.slice(0, dot) : base).trim()
  return title || '未命名书籍'
}
