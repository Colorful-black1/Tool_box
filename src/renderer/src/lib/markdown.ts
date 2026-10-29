/**
 * 轻量 Markdown 渲染（桌面端）—— 把 `shared/markdown` 的 AST 渲染成 HTML。
 *
 * 解析在 `src/shared/markdown.ts`，这里只负责把 AST 变成受控 HTML，
 * 桌面消息和笔记使用相同的表格、任务列表与代码块排版。
 *
 * 安全策略不变：先对全部文本做 HTML 转义，再插入受控标签，
 * 因此原始 HTML 不会执行；HTTP(S) 外链正常渲染，对话专用的内部引用只生成本地按钮。
 */
import { escapeHtml, parseMarkdown } from '../../../shared/markdown'
import type { MdBlock, MdInline } from '../../../shared/markdown'
import { parseAppTarget } from '../../../shared/app-reference'

export { escapeHtml }

/** 渲染整篇 Markdown；空内容给出占位提示 */
export function renderMarkdown(source: string, appLinks = false): string {
  if (!source.trim()) return '<p class="md-empty">（空笔记）</p>'
  return parseMarkdown(source, appLinks).map(renderBlock).join('\n')
}

function renderBlock(block: MdBlock): string {
  switch (block.kind) {
    case 'heading':
      return `<h${block.level}>${renderInlines(block.children)}</h${block.level}>`
    case 'paragraph':
      return `<p>${renderInlines(block.children)}</p>`
    case 'list': {
      const tag = block.ordered ? 'ol' : 'ul'
      const items = block.items
        .map(
          (item) =>
            `<li${item[0]?.kind === 'task' ? ' class="md-task-item"' : ''}>${renderInlines(item)}</li>`
        )
        .join('\n')
      return `<${tag}>\n${items}\n</${tag}>`
    }
    case 'code':
      return `<pre${block.language ? ` data-language="${escapeHtml(block.language)}"` : ''}><code>${escapeHtml(block.text)}</code></pre>`
    case 'quote':
      return `<blockquote>${renderInlines(block.children)}</blockquote>`
    case 'rule':
      return '<hr />'
    case 'table': {
      const row = (cells: MdInline[][], header = false): string => {
        const tag = header ? 'th' : 'td'
        return `<tr>${cells
          .map((cell, column) => {
            const alignment = block.alignments[column]
            return `<${tag}${header ? ' scope="col"' : ''}${alignment ? ` class="md-align-${alignment}"` : ''}>${renderInlines(cell)}</${tag}>`
          })
          .join('')}</tr>`
      }
      return `<div class="md-table-scroll" role="region" aria-label="Markdown 表格" tabindex="0"><table><thead>${row(block.header, true)}</thead><tbody>${block.rows.map((cells) => row(cells)).join('\n')}</tbody></table></div>`
    }
  }
}

function renderInlines(nodes: MdInline[]): string {
  return nodes.map(renderInline).join('')
}

function renderInline(node: MdInline): string {
  switch (node.kind) {
    case 'text':
      return escapeHtml(node.text)
    case 'strong':
      return `<strong>${renderInlines(node.children)}</strong>`
    case 'em':
      return `<em>${renderInlines(node.children)}</em>`
    case 'del':
      return `<del>${renderInlines(node.children)}</del>`
    case 'task':
      return `<span class="md-task-marker" role="img" aria-label="${node.checked ? '已完成' : '未完成'}">${node.checked ? '☑' : '☐'}</span>`
    case 'code':
      return `<code>${escapeHtml(node.text)}</code>`
    case 'link':
      if (node.href.startsWith('toolbox:')) {
        if (!parseAppTarget(node.href)) return renderInlines(node.children)
        return `<button type="button" class="btn-ghost app-reference" data-app-target="${escapeHtml(node.href)}">${renderInlines(node.children)}</button>`
      }
      return `<a href="${escapeHtml(node.href)}" rel="noreferrer noopener" target="_blank">${renderInlines(
        node.children
      )}</a>`
  }
}
