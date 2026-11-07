/**
 * 知识库分块：标题切段 + 递归换行。
 *
 * 目标不是"每块正好 N 字"，而是让每块单独拿出来仍然读得懂：
 * 1. Markdown 按 ATX 标题切 section，块上带标题面包屑（`部署 > 回滚`）；
 * 2. section 内按空行 → 单换行 → 句末标点逐级降级切分；
 * 3. 代码围栏与表格整体不切，超长时独占一块并标 oversized；
 * 4. 碎片反向贪心合并到 target，不跨标题边界，小于 min 的尾块并入前一块；
 * 5. 只在"同一段被打断"的位置带上一句重叠，段落／标题边界不重叠。
 *
 * 纯函数：输入清洗后的正文，输出块与在正文中的偏移，便于详情定位。
 */

export interface ChunkOptions {
  target: number
  min: number
  max: number
}

export interface TextChunk {
  /** 标题面包屑（Markdown 层级用 ` > ` 连接）；纯文本为空串。 */
  heading: string
  content: string
  /** 在清洗后正文中的起始字符偏移（UTF-16 下标）。 */
  startOffset: number
  charCount: number
  /** 代码围栏／表格本身就超过 max，按原子块保留。 */
  oversized: boolean
}

export const DEFAULT_CHUNK_OPTIONS: ChunkOptions = {
  target: 800,
  min: 300,
  max: 1400
}

interface Range {
  start: number
  end: number
}

interface Piece extends Range {
  /** 强制切分时从上一块结尾带来的完整句，最多 100 字。 */
  prefix: string
  /** 带 prefix 的块不能与前一块合并，否则重叠会重复出现。 */
  boundary: boolean
  oversized: boolean
  /** 代码围栏／表格：可以整块合并，但绝不能为了凑长度挪边界切进去。 */
  atomic: boolean
}

interface Section extends Range {
  heading: string
  fromLine: number
  toLine: number
}

interface Line extends Range {
  text: string
}

interface Unit extends Range {
  atomic: boolean
}

const HEADING_PATTERN = /^\s{0,3}(#{1,6})\s+(.*)$/
const FENCE_PATTERN = /^\s{0,3}(```|~~~)/
const TABLE_SEPARATOR_PATTERN = /^\s*\|?[\s:|-]+\|[\s:|-]*$/
const SENTENCE_END_PATTERN = /[。！？；!?;]/
const CLOSING_PUNCTUATION_PATTERN = /[”’」』）)】》]/
const OVERLAP_CHARS = 100
/** 重叠与前缀之间补一个换行，容量计算要把它算进去。 */
const PREFIX_JOIN = '\n'

/** 把任意换行统一成 `\n` 后分块；返回的偏移都相对归一化后的正文。 */
export function chunkText(input: string, options: Partial<ChunkOptions> = {}): TextChunk[] {
  const config: ChunkOptions = { ...DEFAULT_CHUNK_OPTIONS, ...options }
  const text = input.replace(/\r\n?/g, '\n')
  if (!text.trim()) return []
  const lines = scanLines(text)
  const chunks: TextChunk[] = []
  for (const section of splitSections(text, lines)) {
    chunks.push(...chunkSection(text, lines, section, config))
  }
  return chunks
}

function scanLines(text: string): Line[] {
  const lines: Line[] = []
  let start = 0
  for (;;) {
    const newline = text.indexOf('\n', start)
    if (newline === -1) {
      lines.push({ start, end: text.length, text: text.slice(start) })
      break
    }
    lines.push({ start, end: newline + 1, text: text.slice(start, newline) })
    start = newline + 1
    if (start >= text.length) break
  }
  return lines
}

function splitSections(text: string, lines: Line[]): Section[] {
  const sections: Section[] = []
  const stack: string[] = []
  let heading = ''
  let fromLine = 0
  let inFence = false

  const push = (toLine: number): void => {
    const start = fromLine < lines.length ? lines[fromLine].start : text.length
    const end = toLine < lines.length ? lines[toLine].start : text.length
    if (!text.slice(start, end).trim()) return
    sections.push({ heading, start, end, fromLine, toLine })
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (FENCE_PATTERN.test(line.text)) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    const match = HEADING_PATTERN.exec(line.text)
    if (!match) continue
    push(index)
    const level = match[1].length
    stack.length = level - 1
    stack[level - 1] = match[2].replace(/\s+#+\s*$/, '').trim()
    heading = stack.filter((item) => item !== undefined && item !== '').join(' > ')
    fromLine = index + 1
  }
  push(lines.length)
  return sections
}

function chunkSection(
  text: string,
  lines: Line[],
  section: Section,
  config: ChunkOptions
): TextChunk[] {
  const pieces: Piece[] = []
  for (const unit of splitUnits(text, lines, section)) {
    const length = unit.end - unit.start
    if (unit.atomic || length <= config.max) {
      pieces.push({
        start: unit.start,
        end: unit.end,
        prefix: '',
        boundary: false,
        oversized: unit.atomic && length > config.max,
        atomic: unit.atomic
      })
      continue
    }
    pieces.push(...splitLongUnit(text, unit, config.max))
  }

  const merged = mergePieces(pieces, config.target, config.max)
  mergeSmallTail(text, merged, config.min, config.max)

  return merged.map((piece) => {
    const body = text.slice(piece.start, piece.end).trim()
    const content = piece.prefix ? `${piece.prefix}${PREFIX_JOIN}${body}` : body
    return {
      heading: section.heading,
      content,
      startOffset: piece.start,
      charCount: content.length,
      oversized: piece.oversized
    }
  })
}

/** 把 section 拆成段落、代码围栏与表格；后两者标记为原子块。 */
function splitUnits(text: string, lines: Line[], section: Section): Unit[] {
  const units: Unit[] = []
  let index = section.fromLine

  while (index < section.toLine) {
    const line = lines[index]
    if (!line.text.trim()) {
      index += 1
      continue
    }
    if (FENCE_PATTERN.test(line.text)) {
      const opening = index
      index += 1
      while (index < section.toLine && !FENCE_PATTERN.test(lines[index].text)) index += 1
      const closing = Math.min(index, section.toLine - 1)
      units.push({
        start: lines[opening].start,
        end: trimEnd(text, lines[closing].start, lines[closing].end),
        atomic: true
      })
      index = closing + 1
      continue
    }
    if (isTableStart(lines, index, section.toLine)) {
      let last = index
      while (last + 1 < section.toLine && lines[last + 1].text.includes('|')) last += 1
      units.push({
        start: lines[index].start,
        end: trimEnd(text, lines[index].start, lines[last].end),
        atomic: true
      })
      index = last + 1
      continue
    }

    let last = index
    while (
      last + 1 < section.toLine &&
      lines[last + 1].text.trim() &&
      !FENCE_PATTERN.test(lines[last + 1].text) &&
      !isTableStart(lines, last + 1, section.toLine)
    )
      last += 1
    const range = trimRange(text, lines[index].start, lines[last].end)
    if (range.end > range.start) units.push({ ...range, atomic: false })
    index = last + 1
  }

  return units
}

function isTableStart(lines: Line[], index: number, toLine: number): boolean {
  const line = lines[index]
  const separator = index + 1 < toLine ? lines[index + 1] : undefined
  if (!line?.text.includes('|') || !separator) return false
  if (!separator.text.includes('|') || !separator.text.includes('-')) return false
  return TABLE_SEPARATOR_PATTERN.test(separator.text)
}

function trimRange(text: string, start: number, end: number): Range {
  let left = start
  let right = end
  while (left < right && /\s/.test(text[left])) left += 1
  while (right > left && /\s/.test(text[right - 1])) right -= 1
  return { start: left, end: right }
}

function trimEnd(text: string, start: number, end: number): number {
  let right = end
  while (right > start && /\s/.test(text[right - 1])) right -= 1
  return right
}

/** 超长段落：先按句子装块，单句仍超长时按码点硬切，并补上一句重叠。 */
function splitLongUnit(text: string, unit: Unit, max: number): Piece[] {
  const sentences = splitSentences(text, unit)
  const pieces: Piece[] = []
  let current: Range | null = null

  // 重叠也算进 max：除第一块外都预留 OVERLAP_CHARS，避免内容超上限。
  const capacity = (): number =>
    pieces.length === 0 ? max : max - OVERLAP_CHARS - PREFIX_JOIN.length

  const flush = (): void => {
    if (!current) return
    pieces.push({ ...current, prefix: '', boundary: false, oversized: false, atomic: false })
    current = null
  }

  for (const sentence of sentences) {
    const limit = capacity()
    if (sentence.end - sentence.start > limit) {
      flush()
      // 硬切时逐段判断容量：第一段可用满 max，之后都要给重叠留位置。
      let start = sentence.start
      while (start < sentence.end) {
        const size = capacity()
        let end = Math.min(start + size, sentence.end)
        // 不切断代理对：末尾是高代理项时往前退一个码元。
        if (end < sentence.end) {
          const code = text.charCodeAt(end - 1)
          if (code >= 0xd800 && code <= 0xdbff) end -= 1
        }
        pieces.push({ start, end, prefix: '', boundary: false, oversized: false, atomic: false })
        start = end
      }
      continue
    }
    if (current && sentence.end - current.start > limit) flush()
    current = current ? { start: current.start, end: sentence.end } : sentence
  }
  flush()

  // 重叠只发生在"同一段被强制切开"的相邻块之间。
  return pieces.map((piece, index) => {
    if (index === 0) return piece
    const prefix = tailSentence(text.slice(pieces[index - 1].start, pieces[index - 1].end))
    return { ...piece, prefix, boundary: prefix !== '' }
  })
}

function splitSentences(text: string, unit: Unit): Range[] {
  const sentences: Range[] = []
  let start = unit.start
  for (let index = unit.start; index < unit.end; index += 1) {
    const char = text[index]
    if (!SENTENCE_END_PATTERN.test(char) && char !== '\n') continue
    let end = index + 1
    // 句末引号、括号跟着上一句走。
    while (end < unit.end && CLOSING_PUNCTUATION_PATTERN.test(text[end])) end += 1
    if (end > start) sentences.push({ start, end })
    start = end
  }
  if (start < unit.end) sentences.push({ start, end: unit.end })
  return sentences
}

function tailSentence(text: string): string {
  const trimmed = text.trimEnd()
  if (!trimmed) return ''
  const last = lastSentenceEnd(trimmed, trimmed.length - 1)
  if (last === -1) return trimmed.slice(-OVERLAP_CHARS)
  const tail = trimmed.slice(last + 1).trim()
  // 上一块停在句子中间时，残句本身就是衔接下一块所需的上下文。
  if (tail) return tail.slice(-OVERLAP_CHARS)
  const previous = lastSentenceEnd(trimmed, last - 1)
  return trimmed.slice(previous + 1, last + 1).slice(-OVERLAP_CHARS)
}

function lastSentenceEnd(text: string, from: number): number {
  for (let index = from; index >= 0; index -= 1) {
    if (SENTENCE_END_PATTERN.test(text[index]) || text[index] === '\n') return index
  }
  return -1
}

function mergePieces(pieces: Piece[], target: number, max: number): Piece[] {
  const merged: Piece[] = []
  for (const piece of pieces) {
    const previous = merged.at(-1)
    const length = previous ? piece.end - previous.start : 0
    if (
      previous &&
      previous.prefix === '' &&
      !piece.boundary &&
      length <= max &&
      previous.end - previous.start < target
    ) {
      previous.end = piece.end
      previous.oversized = previous.oversized || piece.oversized
      previous.atomic = previous.atomic || piece.atomic
      continue
    }
    merged.push({ ...piece })
  }
  return merged
}

/** 尾块不足 min 时并入前一块；合并会超上限时把前一块尾部挪给尾块。 */
function mergeSmallTail(text: string, pieces: Piece[], min: number, max: number): void {
  while (pieces.length > 1) {
    const last = pieces[pieces.length - 1]
    const previous = pieces[pieces.length - 2]
    if (last.end - last.start >= min) return
    if (previous.prefix === '' && last.end - previous.start <= max) {
      previous.end = last.end
      previous.oversized = previous.oversized || last.oversized
      previous.atomic = previous.atomic || last.atomic
      pieces.pop()
      continue
    }
    // 原子块不能为了凑长度被切开，宁可留一个偏短的尾块。
    if (previous.atomic || last.atomic) return
    let start = last.end - min
    if (start > last.start) {
      const code = text.charCodeAt(start)
      if (code >= 0xdc00 && code <= 0xdfff) start -= 1
    }
    if (start - previous.start >= min) {
      previous.end = start
      last.start = start
    }
    return
  }
}
