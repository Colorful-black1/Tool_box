import { describe, expect, it } from 'vitest'

import { escapeHtml, parseInline, parseMarkdown } from './markdown'

/** 便捷断言：取第一个块 */
function first(source: string) {
  return parseMarkdown(source)[0]
}

describe('parseMarkdown 块级解析', () => {
  it('解析实际 Agent 回复中的四列表格，保留空单元格与行内语法', () => {
    const blocks = parseMarkdown(
      [
        '## 现状',
        '| 对象 | 字段 | 当前 | 目标 |',
        '| --- | :--- | ---: | :---: |',
        '| `purchase_order_item` | 单价含税 | 98.01 | **98.61** |',
        '| | 单价不含税 | 97.04 | **97.63** |',
        '',
        '后续说明'
      ].join('\r\n')
    )
    expect(blocks.map((block) => block.kind)).toEqual(['heading', 'table', 'paragraph'])
    const table = blocks[1]
    expect(table.kind).toBe('table')
    if (table.kind !== 'table') throw new Error('未解析出表格')
    expect(table.alignments).toEqual([null, 'left', 'right', 'center'])
    expect(table.rows).toHaveLength(2)
    expect(table.rows[0][0]).toEqual([{ kind: 'code', text: 'purchase_order_item' }])
    expect(table.rows[0][3][0].kind).toBe('strong')
    expect(table.rows[1][0]).toEqual([])
  })

  it('表格支持可选外侧竖线、转义竖线、代码中的竖线，并规范不等长行', () => {
    const table = first(
      '字段 | 值\n--- | ---\none\\|two | ``a`|b``\n缺少尾列 |\n额外 | 保留 | 丢弃\n转义代码 | `a\\|b`'
    )
    if (table.kind !== 'table') throw new Error('未解析出表格')
    expect(table.rows[0][0]).toEqual([{ kind: 'text', text: 'one|two' }])
    expect(table.rows[0][1]).toEqual([{ kind: 'code', text: 'a`|b' }])
    expect(table.rows[1][1]).toEqual([])
    expect(table.rows[2]).toHaveLength(2)
    expect(table.rows[3][1]).toEqual([{ kind: 'code', text: 'a|b' }])
  })

  it('普通竖线、列数不符和流式尚未写完的分隔行不误判为表格', () => {
    for (const source of ['a | b', 'a | b\n--- |', 'a | b\n| --'])
      expect(parseMarkdown(source).some((block) => block.kind === 'table')).toBe(false)
    expect(first('```text\na | b\n--- | ---\n```')).toEqual({
      kind: 'code',
      language: 'text',
      text: 'a | b\n--- | ---'
    })
  })

  it('只有匹配字符且足够长的代码围栏能闭合，流式代码保留语言和原文', () => {
    expect(first('````markdown\n```sql\nSELECT 1;\n```\n````')).toEqual({
      kind: 'code',
      language: 'markdown',
      text: '```sql\nSELECT 1;\n```'
    })
    expect(first('~~~sql\nSELECT 1;')).toEqual({
      kind: 'code',
      language: 'sql',
      text: 'SELECT 1;'
    })
  })

  it('任务标记仅在无序列表中解析，复选状态只读', () => {
    const list = first('- [ ] 待核对\n- [x] **已完成**\n- [X] 也已完成')
    if (list.kind !== 'list') throw new Error('未解析出列表')
    expect(list.items[0][0]).toEqual({ kind: 'task', checked: false })
    expect(list.items[1][0]).toEqual({ kind: 'task', checked: true })
    expect(list.items[2][0]).toEqual({ kind: 'task', checked: true })
    expect(first('[x] 普通文本')).toMatchObject({ kind: 'paragraph' })
  })

  it('空内容解析出空数组', () => {
    expect(parseMarkdown('')).toEqual([])
    expect(parseMarkdown('   \n  ')).toEqual([])
  })

  it('解析标题并带层级', () => {
    expect(first('# 一级')).toEqual({
      kind: 'heading',
      level: 1,
      children: [{ kind: 'text', text: '一级' }]
    })
    expect(first('### 三级')).toMatchObject({ kind: 'heading', level: 3 })
  })

  it('每个非空行各自成段（沿用桌面端原行为）', () => {
    const blocks = parseMarkdown('第一行\n第二行')
    expect(blocks).toHaveLength(2)
    expect(blocks[0]).toMatchObject({ kind: 'paragraph' })
    expect(blocks[1]).toMatchObject({ kind: 'paragraph' })
  })

  it('同类列表项合并为一个列表', () => {
    const blocks = parseMarkdown('- 一\n- 二\n\n1. 甲\n2. 乙')
    expect(blocks).toHaveLength(2)
    expect(blocks[0]).toMatchObject({ kind: 'list', ordered: false })
    expect(blocks[1]).toMatchObject({ kind: 'list', ordered: true })
    expect((blocks[0] as { items: unknown[] }).items).toHaveLength(2)
  })

  it('列表类型切换时结束前一个列表', () => {
    const blocks = parseMarkdown('- 一\n1. 甲')
    expect(blocks).toHaveLength(2)
    expect(blocks[0]).toMatchObject({ kind: 'list', ordered: false })
    expect(blocks[1]).toMatchObject({ kind: 'list', ordered: true })
  })

  it('解析围栏代码块且内部不解析其它语法', () => {
    const blocks = parseMarkdown('```\n**不是粗体**\n```')
    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toEqual({ kind: 'code', text: '**不是粗体**' })
  })

  it('围栏没闭合也要保留内容', () => {
    const blocks = parseMarkdown('```\n半截代码')
    expect(blocks).toEqual([{ kind: 'code', text: '半截代码' }])
  })

  it('解析引用与分割线', () => {
    expect(first('> 引用')).toMatchObject({ kind: 'quote' })
    expect(first('---')).toEqual({ kind: 'rule' })
    expect(first('***')).toEqual({ kind: 'rule' })
  })

  it('HTML 只当普通文本，不会变成标签', () => {
    const blocks = parseMarkdown('<script>alert(1)</script>')
    expect(blocks[0]).toMatchObject({ kind: 'paragraph' })
    const inline = (blocks[0] as { children: Array<{ text?: string }> }).children
    expect(inline[0]?.text).toBe('<script>alert(1)</script>')
  })
})

describe('parseInline 行内解析', () => {
  it('删除线和转义标记可与代码混排，代码内部不做格式转换', () => {
    expect(parseInline('~~旧值~~ \\*文字\\* `~~原样~~`')).toEqual([
      { kind: 'del', children: [{ kind: 'text', text: '旧值' }] },
      { kind: 'text', text: ' *文字* ' },
      { kind: 'code', text: '~~原样~~' }
    ])
  })

  it('解析粗体 / 斜体 / 行内代码', () => {
    expect(parseInline('**粗**')).toEqual([
      { kind: 'strong', children: [{ kind: 'text', text: '粗' }] }
    ])
    expect(parseInline('*斜*')).toEqual([
      { kind: 'em', children: [{ kind: 'text', text: '斜' }] }
    ])
    expect(parseInline('`code`')).toEqual([{ kind: 'code', text: 'code' }])
  })

  it('混合行内语法按顺序保留', () => {
    expect(parseInline('**粗** 与 *斜*')).toEqual([
      { kind: 'strong', children: [{ kind: 'text', text: '粗' }] },
      { kind: 'text', text: ' 与 ' },
      { kind: 'em', children: [{ kind: 'text', text: '斜' }] }
    ])
  })

  it('行内代码内部不再解析其它语法', () => {
    expect(parseInline('`**不是粗体**`')).toEqual([
      { kind: 'code', text: '**不是粗体**' }
    ])
  })

  it('粗体内部可以嵌套行内代码', () => {
    expect(parseInline('**含 `code`**')).toEqual([
      {
        kind: 'strong',
        children: [
          { kind: 'text', text: '含 ' },
          { kind: 'code', text: 'code' }
        ]
      }
    ])
  })

  it('解析 http / https 链接', () => {
    expect(parseInline('[站点](https://example.com)')).toEqual([
      {
        kind: 'link',
        href: 'https://example.com',
        children: [{ kind: 'text', text: '站点' }]
      }
    ])
  })

  it('非 http 协议的链接按普通文本处理', () => {
    expect(parseInline('[危险](javascript:alert(1))')).toEqual([
      { kind: 'text', text: '[危险](javascript:alert(1))' }
    ])
  })

  it('未闭合的语法标记按普通文本处理', () => {
    expect(parseInline('**没闭合')).toEqual([{ kind: 'text', text: '**没闭合' }])
  })
})

describe('escapeHtml', () => {
  it('转义 HTML 敏感字符', () => {
    expect(escapeHtml('<script>"x" & \'y\'</script>')).toBe(
      '&lt;script&gt;&quot;x&quot; &amp; &#39;y&#39;&lt;/script&gt;'
    )
  })
})
