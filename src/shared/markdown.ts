/**
 * 轻量 Markdown 解析（两端共用）—— 只做**解析**，不做渲染。
 *
 * 为什么要抽到 shared：
 * - 桌面端原本只有 `renderer/src/lib/markdown.ts`，输出 **HTML 字符串**，
 *   React Native 渲染不了 HTML，两端无法共用；
 * - 现在这里输出**结构化 AST**，桌面端把 AST 渲染成 HTML，
 *   手机端把同一份 AST 渲染成 RN 组件，语法子集因此天然一致。
 *
 * 语法子集与原桌面端实现**逐条对齐**（不要在此基础上偷偷加语法，
 * 两端渲染结果会分叉）：标题、段落、无序/有序列表、围栏代码块、
 * 引用、分割线，行内支持粗体 / 斜体 / 行内代码 / 链接。
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
  | { kind: 'code'; text: string }
  | { kind: 'link'; href: string; children: MdInline[] }

/** 块级节点 */
export type MdBlock =
  | { kind: 'heading'; level: number; children: MdInline[] }
  | { kind: 'paragraph'; children: MdInline[] }
  | { kind: 'list'; ordered: boolean; items: MdInline[][] }
  | { kind: 'code'; text: string }
  | { kind: 'quote'; children: MdInline[] }
  | { kind: 'rule' }

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

/** 链接只允许 http / https，避免 `javascript:` 之类的协议混进 href */
const LINK_PATTERN = /^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/

/**
 * 解析行内语法。
 *
 * 扫描式实现：每一步找当前最靠左的语法标记（行内代码 / 粗体 / 斜体 / 链接），
 * 命中就递归解析其内部内容，因此 `**里面带 `code`**` 这类嵌套也能正确还原。
 */
export function parseInline(text: string): MdInline[] {
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

    // 行内代码：内容不再解析其它语法
    if (char === '`') {
      const end = text.indexOf('`', index + 1)
      if (end > index + 1) {
        flush()
        nodes.push({ kind: 'code', text: text.slice(index + 1, end) })
        index = end + 1
        continue
      }
    }

    // 粗体：必须在斜体之前判断，否则 `**` 会被吃成两个空斜体
    if (char === '*' && text[index + 1] === '*') {
      const end = text.indexOf('**', index + 2)
      if (end > index + 2) {
        flush()
        nodes.push({ kind: 'strong', children: parseInline(text.slice(index + 2, end)) })
        index = end + 2
        continue
      }
    }

    // 斜体
    if (char === '*') {
      const end = text.indexOf('*', index + 1)
      if (end > index + 1) {
        flush()
        nodes.push({ kind: 'em', children: parseInline(text.slice(index + 1, end)) })
        index = end + 1
        continue
      }
    }

    // 链接
    if (char === '[') {
      const match = LINK_PATTERN.exec(text.slice(index))
      if (match) {
        flush()
        nodes.push({
          kind: 'link',
          href: match[2],
          children: parseInline(match[1])
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
export function parseMarkdown(source: string): MdBlock[] {
  const blocks: MdBlock[] = []
  const lines = source.split('\n')

  let inCode = false
  let codeLines: string[] = []
  /** 当前正在累积的列表；同类项连续出现时合并进同一个列表 */
  let list: { ordered: boolean; items: MdInline[][] } | null = null

  const closeList = (): void => {
    if (!list) return
    blocks.push({ kind: 'list', ordered: list.ordered, items: list.items })
    list = null
  }

  for (const raw of lines) {
    // 围栏代码块
    if (raw.trim().startsWith('```')) {
      closeList()
      if (inCode) {
        blocks.push({ kind: 'code', text: codeLines.join('\n') })
        codeLines = []
        inCode = false
      } else {
        inCode = true
      }
      continue
    }
    if (inCode) {
      codeLines.push(raw)
      continue
    }

    // 标题
    const heading = raw.match(/^(#{1,6})\s+(.*)$/)
    if (heading) {
      closeList()
      blocks.push({
        kind: 'heading',
        level: heading[1].length,
        children: parseInline(heading[2])
      })
      continue
    }

    // 引用
    const quote = raw.match(/^>\s?(.*)$/)
    if (quote) {
      closeList()
      blocks.push({ kind: 'quote', children: parseInline(quote[1]) })
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
      list.items.push(parseInline(unordered[1]))
      continue
    }

    // 有序列表
    const ordered = raw.match(/^\s*\d+\.\s+(.*)$/)
    if (ordered) {
      if (!list || !list.ordered) {
        closeList()
        list = { ordered: true, items: [] }
      }
      list.items.push(parseInline(ordered[1]))
      continue
    }

    // 空行：结束当前列表
    if (!raw.trim()) {
      closeList()
      continue
    }

    closeList()
    blocks.push({ kind: 'paragraph', children: parseInline(raw) })
  }

  closeList()
  // 围栏没闭合也要把内容吐出来，否则最后一段代码会整段消失
  if (inCode) {
    blocks.push({ kind: 'code', text: codeLines.join('\n') })
  }

  return blocks
}
