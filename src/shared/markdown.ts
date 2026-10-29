/**
 * 轻量 Markdown 解析（两端共用）—— 只做**解析**，不做渲染。
 *
 * 为什么要抽到 shared：
 * - 桌面端原本只有 `renderer/src/lib/markdown.ts`，输出 **HTML 字符串**，
 *   React Native 渲染不了 HTML，两端无法共用；
 * - 现在这里输出**结构化 AST**，桌面端把 AST 渲染成 HTML，
 *   手机端保留历史 AST 的 RN 渲染，冻结期间不跟随桌面新增节点。
 *
 * 默认语法保持兼容；桌面对话可显式启用应用内引用，其余调用不变。
 * 标题、段落、无序/有序列表、任务列表、围栏代码块、表格、
 * 引用、分割线，行内支持粗体 / 斜体 / 删除线 / 行内代码 / 链接。
 * 手机端已冻结，新增节点的渲染仅在桌面端维护。
 *
 * 块级行为沿用桌面端原实现：每个非空行各自成段（不合并成多行段落），
 * 引用每行一个 `<blockquote>`，列表按同类连续项合并。
 *
 * 本文件不 import 任何 Node / Electron / RN 模块，可在 vitest 中直接测。
 */

/** 行内节点 */
export type MdInline =
  | { kind: 'text'; text: string }
  | { kind: 'strong'; children: MdInline[] }
  | { kind: 'em'; children: MdInline[] }
  | { kind: 'del'; children: MdInline[] }
  | { kind: 'task'; checked: boolean }
  | { kind: 'code'; text: string }
  | { kind: 'link'; href: string; children: MdInline[] }

/** 块级节点 */
export type MdBlock =
  | { kind: 'heading'; level: number; children: MdInline[] }
  | { kind: 'paragraph'; children: MdInline[] }
  | { kind: 'list'; ordered: boolean; items: MdInline[][] }
  | { kind: 'code'; text: string; language?: string }
  | { kind: 'quote'; children: MdInline[] }
  | { kind: 'rule' }
  | {
      kind: 'table'
      alignments: Array<'left' | 'center' | 'right' | null>
      header: MdInline[][]
      rows: MdInline[][][]
    }

/** 行内代码只由相同长度的反引号闭合，较长围栏里的单反引号是正文。 */
function closingTicks(text: string, start: number, length: number): number {
  const marker = '`'.repeat(length)
  let index = text.indexOf(marker, start)
  while (index !== -1) {
    if (text[index - 1] !== '`' && text[index + length] !== '`') return index
    index = text.indexOf(marker, index + length)
  }
  return -1
}

/** 按单元格拆行，保留转义符供行内解析；代码中的竖线不拆列。 */
function tableCells(raw: string): string[] | null {
  const source = raw.trim()
  const cells: string[] = []
  let buffer = ''
  let code = 0
  for (let index = 0; index < source.length; index++) {
    const char = source[index]
    if (char === '\\' && !code && index + 1 < source.length) {
      buffer += char + source[++index]
    } else if (char === '`') {
      let end = index + 1
      while (source[end] === '`') end++
      const marker = source.slice(index, end)
      if (code === marker.length) code = 0
      else if (!code && closingTicks(source, end, marker.length) !== -1) code = marker.length
      buffer += marker
      index = end - 1
    } else if (char === '|' && !code) {
      cells.push(buffer.trim())
      buffer = ''
    } else buffer += char
  }
  if (!cells.length) return null
  cells.push(buffer.trim())
  if (source.startsWith('|')) cells.shift()
  if (cells.at(-1) === '' && source.endsWith('|')) cells.pop()
  return cells
}

/** 必须有同列数的分隔行才认作表格；流式尚未写完时保留普通文本。 */
function parseTable(
  lines: string[],
  index: number,
  appLinks: boolean
): { block: MdBlock; next: number } | null {
  if (!lines[index].includes('|')) return null
  const header = tableCells(lines[index])
  const separators = tableCells(lines[index + 1] ?? '')
  if (
    !header?.length ||
    !separators ||
    header.length !== separators.length ||
    !separators.every((cell) => /^:?-+:?$/.test(cell))
  )
    return null
  const alignments: Extract<MdBlock, { kind: 'table' }>['alignments'] = separators.map((cell) => {
    if (cell.startsWith(':') && cell.endsWith(':')) return 'center'
    if (cell.endsWith(':')) return 'right'
    return cell.startsWith(':') ? 'left' : null
  })
  const rows: MdInline[][][] = []
  const inline = (cell: string): MdInline[] => parseInline(cell.replace(/\\\|/g, '|'), appLinks)
  let next = index + 2
  while (next < lines.length && lines[next].trim()) {
    if (/^\s*(?:#{1,6}\s|>|`{3,}|~{3,}|[-*+]\s|\d+[.)]\s)/.test(lines[next])) break
    const cells = tableCells(lines[next])
    if (!cells) break
    rows.push(header.map((_, column) => inline(cells[column] ?? '')))
    next++
  }
  return {
    block: {
      kind: 'table',
      alignments,
      header: header.map(inline),
      rows
    },
    next
  }
}

const ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
}

/** HTML 转义：桌面端渲染 HTML 时用；手机端渲染 RN 组件时不需要 */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => ESCAPE_MAP[char])
}

/** 默认只接受 HTTP(S)；内部引用由桌面对话显式启用并在渲染前做页面白名单校验。 */
const LINK_PATTERN = /^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/
const APP_LINK_PATTERN = /^\[([^\]]+)\]\((toolbox:\/\/[^)\s]+)\)/

/**
 * 解析行内语法。
 *
 * 扫描式实现：每一步找当前最靠左的语法标记（行内代码 / 粗体 / 斜体 / 链接），
 * 命中就递归解析其内部内容，因此 `**里面带 `code`**` 这类嵌套也能正确还原。
 */
export function parseInline(text: string, appLinks = false): MdInline[] {
  const nodes: MdInline[] = []
  let buffer = ''
  let index = 0

  const flush = (): void => {
    if (!buffer) return
    nodes.push({ kind: 'text', text: buffer })
    buffer = ''
  }

  while (index < text.length) {
    const char = text[index]

    const nextChar = text[index + 1]
    if (char === '\\' && nextChar && '\\`*{}[]()#+.!_|>~-'.includes(nextChar)) {
      buffer += nextChar
      index += 2
      continue
    }

    // 行内代码：内容不再解析其它语法
    if (char === '`') {
      let start = index + 1
      while (text[start] === '`') start++
      const length = start - index
      const end = closingTicks(text, start, length)
      if (end > start) {
        flush()
        nodes.push({ kind: 'code', text: text.slice(start, end) })
        index = end + length
        continue
      }
      buffer += text.slice(index, start)
      index = start
      continue
    }

    // 粗体：必须在斜体之前判断，否则 `**` 会被吃成两个空斜体
    if (char === '*' && text[index + 1] === '*') {
      const end = text.indexOf('**', index + 2)
      if (end > index + 2) {
        flush()
        nodes.push({ kind: 'strong', children: parseInline(text.slice(index + 2, end), appLinks) })
        index = end + 2
        continue
      }
    }

    // 斜体
    if (char === '*') {
      const end = text.indexOf('*', index + 1)
      if (end > index + 1) {
        flush()
        nodes.push({ kind: 'em', children: parseInline(text.slice(index + 1, end), appLinks) })
        index = end + 1
        continue
      }
    }

    if (char === '~' && text[index + 1] === '~') {
      const end = text.indexOf('~~', index + 2)
      if (end > index + 2) {
        flush()
        nodes.push({ kind: 'del', children: parseInline(text.slice(index + 2, end), appLinks) })
        index = end + 2
        continue
      }
    }

    // 链接
    if (char === '[') {
      const match = LINK_PATTERN.exec(text.slice(index)) ?? (appLinks ? APP_LINK_PATTERN.exec(text.slice(index)) : null)
      if (match) {
        flush()
        nodes.push({
          kind: 'link',
          href: match[2],
          children: parseInline(match[1], appLinks)
        })
        index += match[0].length
        continue
      }
    }

    buffer += char
    index += 1
  }

  flush()
  return nodes
}

/** 解析整篇 Markdown，返回块级 AST */
export function parseMarkdown(source: string, appLinks = false): MdBlock[] {
  const blocks: MdBlock[] = []
  const lines = source.split(/\r?\n/)

  let codeFence: { marker: string; length: number; language?: string } | null = null
  let codeLines: string[] = []
  /** 当前正在累积的列表；同类项连续出现时合并进同一个列表 */
  let list: { ordered: boolean; items: MdInline[][] } | null = null

  const closeList = (): void => {
    if (!list) return
    blocks.push({ kind: 'list', ordered: list.ordered, items: list.items })
    list = null
  }

  const closeCode = (): void => {
    blocks.push({
      kind: 'code',
      text: codeLines.join('\n'),
      ...(codeFence?.language ? { language: codeFence.language } : {})
    })
    codeLines = []
    codeFence = null
  }

  for (let index = 0; index < lines.length; index++) {
    const raw = lines[index]
    // 围栏代码块
    const fence = raw.match(/^ {0,3}(`{3,}|~{3,})(.*)$/)
    if (codeFence) {
      if (
        fence &&
        fence[1][0] === codeFence.marker &&
        fence[1].length >= codeFence.length &&
        !fence[2].trim()
      )
        closeCode()
      else codeLines.push(raw)
      continue
    }
    if (fence) {
      closeList()
      const language = fence[2].trim().split(/\s+/)[0]
      codeFence = {
        marker: fence[1][0],
        length: fence[1].length,
        ...(/^[\w#+.-]{1,32}$/.test(language) ? { language } : {})
      }
      continue
    }

    // 标题
    const heading = raw.match(/^(#{1,6})\s+(.*)$/)
    if (heading) {
      closeList()
      blocks.push({
        kind: 'heading',
        level: heading[1].length,
        children: parseInline(heading[2], appLinks)
      })
      continue
    }

    // 引用
    const quote = raw.match(/^>\s?(.*)$/)
    if (quote) {
      closeList()
      blocks.push({ kind: 'quote', children: parseInline(quote[1], appLinks) })
      continue
    }

    // 分割线
    if (/^(-{3,}|\*{3,})$/.test(raw.trim())) {
      closeList()
      blocks.push({ kind: 'rule' })
      continue
    }

    // 无序列表
    const unordered = raw.match(/^\s*[-*+]\s+(.*)$/)
    if (unordered) {
      if (!list || list.ordered) {
        closeList()
        list = { ordered: false, items: [] }
      }
      const task = unordered[1].match(/^\[([ xX])\]\s+(.*)$/)
      list.items.push(
        task
          ? [
              { kind: 'task', checked: task[1].toLowerCase() === 'x' },
              ...parseInline(task[2], appLinks)
            ]
          : parseInline(unordered[1], appLinks)
      )
      continue
    }

    // 有序列表
    const ordered = raw.match(/^\s*\d+\.\s+(.*)$/)
    if (ordered) {
      if (!list || !list.ordered) {
        closeList()
        list = { ordered: true, items: [] }
      }
      list.items.push(parseInline(ordered[1], appLinks))
      continue
    }

    const table = parseTable(lines, index, appLinks)
    if (table) {
      closeList()
      blocks.push(table.block)
      index = table.next - 1
      continue
    }

    // 空行：结束当前列表
    if (!raw.trim()) {
      closeList()
      continue
    }

    closeList()
    blocks.push({ kind: 'paragraph', children: parseInline(raw, appLinks) })
  }

  closeList()
  // 围栏没闭合也要把内容吐出来，否则最后一段代码会整段消失
  if (codeFence) closeCode()

  return blocks
}
