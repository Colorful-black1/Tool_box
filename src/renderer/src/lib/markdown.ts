/**
 * 轻量 Markdown 渲染（对应旧项目 flutter_markdown 的常用子集）。
 * 安全策略：先对全部输入做 HTML 转义，再插入受控标签，
 * 因此用户笔记里的原始 HTML 不会被执行。
 */

const ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
}

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => ESCAPE_MAP[char])
}

export function renderMarkdown(source: string): string {
  if (!source.trim()) return '<p class="md-empty">（空笔记）</p>'

  const escaped = escapeHtml(source)
  const lines = escaped.split('\n')
  const out: string[] = []

  let inCodeBlock = false
  let listType: 'ul' | 'ol' | null = null

  const closeList = (): void => {
    if (listType) {
      out.push(listType === 'ul' ? '</ul>' : '</ol>')
      listType = null
    }
  }

  for (const raw of lines) {
    // 代码块
    if (raw.trim().startsWith('```')) {
      closeList()
      out.push(inCodeBlock ? '</code></pre>' : '<pre><code>')
      inCodeBlock = !inCodeBlock
      continue
    }
    if (inCodeBlock) {
      out.push(`${raw}\n`)
      continue
    }

    // 标题
    const heading = raw.match(/^(#{1,6})\s+(.*)$/)
    if (heading) {
      closeList()
      const level = heading[1].length
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`)
      continue
    }

    // 引用
    const quote = raw.match(/^&gt;\s?(.*)$/)
    if (quote) {
      closeList()
      out.push(`<blockquote>${inline(quote[1])}</blockquote>`)
      continue
    }

    // 分割线
    if (/^(-{3,}|\*{3,})$/.test(raw.trim())) {
      closeList()
      out.push('<hr />')
      continue
    }

    // 无序列表
    const unordered = raw.match(/^\s*[-*+]\s+(.*)$/)
    if (unordered) {
      if (listType !== 'ul') {
        closeList()
        out.push('<ul>')
        listType = 'ul'
      }
      out.push(`<li>${inline(unordered[1])}</li>`)
      continue
    }

    // 有序列表
    const ordered = raw.match(/^\s*\d+\.\s+(.*)$/)
    if (ordered) {
      if (listType !== 'ol') {
        closeList()
        out.push('<ol>')
        listType = 'ol'
      }
      out.push(`<li>${inline(ordered[1])}</li>`)
      continue
    }

    // 空行
    if (!raw.trim()) {
      closeList()
      continue
    }

    closeList()
    out.push(`<p>${inline(raw)}</p>`)
  }

  closeList()
  if (inCodeBlock) out.push('</code></pre>')

  return out.join('\n')
}

/** 行内语法：粗体 / 斜体 / 行内代码 / 链接 */
function inline(text: string): string {
  return text
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(
      /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
      '<a href="$2" rel="noreferrer noopener" target="_blank">$1</a>'
    )
}