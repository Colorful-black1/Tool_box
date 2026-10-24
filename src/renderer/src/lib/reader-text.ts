/**
 * 把章节正文切成段落。
 *
 * TXT 常见两种写法：
 * - 一段一行，行首常带两个全角空格（本仓库导入的《凡人修仙传》就是这种）；
 * - 按固定列数硬换行，段与段之间没有空行。
 *
 * 先按行去掉首尾空白；一行若不以句末标点收尾，就与下一行合并，兼容第二种。
 * 空行始终视为段落边界，避免把真正分开的短段合并。
 */
const PARAGRAPH_END_RE = /[。！？…!?.]["'”’』」）】》]?$/
const LATIN_TAIL_RE = /[A-Za-z0-9]$/
const LATIN_HEAD_RE = /^[A-Za-z0-9]/

export function splitReaderParagraphs(text: string): string[] {
  const paragraphs: string[] = []
  let buffer = ''

  const flush = (): void => {
    if (buffer) paragraphs.push(buffer)
    buffer = ''
  }

  for (const rawLine of text.replace(/\r\n?/g, '\n').split('\n')) {
    const line = rawLine.replace(/^[\s\u3000]+/, '').trimEnd()
    if (!line) {
      flush()
      continue
    }

    if (!buffer) {
      buffer = line
    } else if (LATIN_TAIL_RE.test(buffer) && LATIN_HEAD_RE.test(line)) {
      buffer = `${buffer} ${line}`
    } else {
      buffer += line
    }

    if (PARAGRAPH_END_RE.test(line)) flush()
  }

  flush()
  return paragraphs
}
