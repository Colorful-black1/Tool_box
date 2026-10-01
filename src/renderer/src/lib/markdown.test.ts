import { describe, expect, it } from 'vitest'

import { escapeHtml, renderMarkdown } from './markdown'

describe('escapeHtml', () => {
  it('escapes HTML-significant characters', () => {
    expect(escapeHtml('<script>"x" & \'y\'</script>')).toBe(
      '&lt;script&gt;&quot;x&quot; &amp; &#39;y&#39;&lt;/script&gt;'
    )
  })
})

describe('renderMarkdown', () => {
  it('renders an empty placeholder', () => {
    expect(renderMarkdown('  ')).toContain('（空笔记）')
  })

  it('renders headings, bold and italic', () => {
    const html = renderMarkdown('# 标题\n**粗** 与 *斜*')
    expect(html).toContain('<h1>标题</h1>')
    expect(html).toContain('<strong>粗</strong>')
    expect(html).toContain('<em>斜</em>')
  })

  it('renders unordered and ordered lists', () => {
    const html = renderMarkdown('- 一\n- 二\n\n1. 甲\n2. 乙')
    expect(html).toContain('<ul>')
    expect(html).toContain('<li>一</li>')
    expect(html).toContain('<ol>')
    expect(html).toContain('<li>甲</li>')
  })

  it('renders code fences and inline code', () => {
    const html = renderMarkdown('行内 `code`\n\n```\nblock\n```')
    expect(html).toContain('<code>code</code>')
    expect(html).toContain('<pre><code>')
  })

  it('renders blockquotes, rules and links', () => {
    const html = renderMarkdown('> 引用\n\n---\n\n[站点](https://example.com)')
    expect(html).toContain('<blockquote>引用</blockquote>')
    expect(html).toContain('<hr />')
    expect(html).toContain('href="https://example.com"')
  })

  it('never emits raw script tags from user input', () => {
    const html = renderMarkdown('<script>alert(1)</script>')
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })
})