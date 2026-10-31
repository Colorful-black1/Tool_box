/**
 * 阅读器摘录：把正文里选中的文字整理成记事本可直接保存的标题与 Markdown 内容。
 * 纯逻辑，不依赖 DOM / Node，便于单测与后续复用。
 */

/** 与 notes:save 的标题上限保持一致，超出会整条保存失败。 */
const NOTE_TITLE_LIMIT = 60
/** 问 AI 的草稿上限：选中整章时也保持一次可发送、可阅读的长度。 */
const QUESTION_LIMIT = 4000

export interface ReaderExcerptInput {
  bookTitle: string
  chapterTitle: string
  /** 章节在目录中的下标（0 起）。 */
  chapterIdx: number
  selectedText: string
}

export interface ReaderExcerptNote {
  title: string
  content: string
}

/** 书名 / 章节名来自解析结果，统一收敛成单行，避免标题里出现换行。 */
function normalizeLabel(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function trimTitle(value: string): string {
  return value.length > NOTE_TITLE_LIMIT ? `${value.slice(0, NOTE_TITLE_LIMIT - 1)}…` : value
}

/** 选区可能带缩进、空行与行尾空白，逐段收敛但保留段落结构。 */
function normalizeParagraphs(text: string): string[] {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}

/** 书名 + 章节标题 → 摘录标题与来源行，笔记和问 AI 共用同一套定位文案。 */
function describeSource(input: ReaderExcerptInput): { label: string; source: string } {
  const index = input.chapterIdx + 1
  const book = normalizeLabel(input.bookTitle)
  const chapter = normalizeLabel(input.chapterTitle)
  const label = book ? (chapter ? `《${book}》· ${chapter}` : `《${book}》`) : chapter
  const source = label ? `${label}（第 ${index} 章）` : `第 ${index} 章`
  return { label, source }
}

/**
 * 选区为空（只有空白）时返回 null，调用方应保持入口隐藏而不是保存空笔记。
 */
export function buildReaderExcerpt(input: ReaderExcerptInput): ReaderExcerptNote | null {
  const paragraphs = normalizeParagraphs(input.selectedText)
  if (!paragraphs.length) return null

  const { label, source } = describeSource(input)
  const index = input.chapterIdx + 1
  const quote = paragraphs.map((line) => `> ${line}`).join('\n>\n')
  return {
    title: trimTitle(label || `第 ${index} 章摘录`),
    content: `${quote}\n\n—— ${source}`
  }
}

/** 把选中正文整理成发往 AI 对话的草稿：问题在前，原文与来源在后。 */
export function buildReaderQuestion(input: ReaderExcerptInput): string | null {
  const paragraphs = normalizeParagraphs(input.selectedText)
  if (!paragraphs.length) return null
  const { source } = describeSource(input)
  const quote = paragraphs.map((line) => `> ${line}`).join('\n>\n')
  const question = `请解释下面这段内容，并补充必要的背景：\n\n${quote}\n\n—— ${source}`
  return question.length > QUESTION_LIMIT ? `${question.slice(0, QUESTION_LIMIT)}…` : question
}
