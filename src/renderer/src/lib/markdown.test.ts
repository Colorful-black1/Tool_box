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
  it('表格输出可横向滚动的语义结构、表头和列对齐', () => {
    const html = renderMarkdown(
      '| 字段 | 当前 | 目标 |\n| --- | ---: | :---: |\n| `price` | 98.01 | **98.61** |'
    )
    expect(html).toContain('class="md-table-scroll"')
    expect(html).toContain('role="region" aria-label="Markdown 表格" tabindex="0"')
    expect(html).toContain('<thead><tr><th scope="col">字段</th>')
    expect(html).toContain('<td class="md-align-right">98.01</td>')
    expect(html).toContain('<td class="md-align-center"><strong>98.61</strong></td>')
    expect(html).toContain('<td><code>price</code></td>')
  })

  it('表格与代码语言不能注入 HTML、事件或危险链接', () => {
    const html = renderMarkdown(
      '| 项目 | 内容 |\n| --- | --- |\n| <img src=x onerror=alert(1)> | [危险](javascript:alert(1)) |'
    )
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(html).not.toContain('<img')
    expect(html).not.toContain('<a href')
    expect(renderMarkdown('```sql\n<script>危险</script>\n```')).toContain('data-language="sql"')
    const code = renderMarkdown('```js" onmouseover="bad\n<img src=x>\n```')
    expect(code).not.toContain('data-language')
    expect(code).not.toContain('<img')
  })

  it('任务列表与删除线正确渲染，保持只读且可识别状态', () => {
    const html = renderMarkdown('- [ ] 待处理\n- [x] ~~已替换~~')
    expect(html).toContain('<li class="md-task-item">')
    expect(html).toContain('aria-label="未完成"')
    expect(html).toContain('aria-label="已完成"')
    expect(html).toContain('<del>已替换</del>')
    expect(html).not.toContain('<input')
  })

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

  it('列表渲染成连续的 li', () => {
    expect(renderMarkdown('- 一\n- 二')).toContain('<ul>\n<li>一</li>\n<li>二</li>\n</ul>')
  })

  it('代码块里的 HTML 也会被转义', () => {
    expect(renderMarkdown('```\n<b>x</b>\n```')).toContain('&lt;b&gt;x&lt;/b&gt;')
  })

  it('非 http 协议的链接不会变成 a 标签', () => {
    expect(renderMarkdown('[x](javascript:alert(1))')).not.toContain('<a href')
  })

  it('只有对话显式启用的合法应用入口会变成按钮', () => {
    const source = '[打开笔记](toolbox://open/note/n1)'
    expect(renderMarkdown(source)).not.toContain('data-app-target')
    expect(renderMarkdown(source, true)).toContain('type="button"')
    expect(renderMarkdown(source, true)).toContain('data-app-target="toolbox://open/note/n1"')
    expect(renderMarkdown('[危险](toolbox://open/delete/n1)', true)).not.toContain(
      'data-app-target'
    )
    expect(renderMarkdown('[外部](https://example.com)', true)).toContain('target="_blank"')
    expect(renderMarkdown('```\n' + source + '\n```', true)).not.toContain('data-app-target')
  })
})
