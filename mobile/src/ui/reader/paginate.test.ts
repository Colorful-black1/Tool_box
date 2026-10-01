import { describe, expect, it } from 'vitest'

import {
  clampPageIndex,
  estimatePageChars,
  pageToPercent,
  paginateText,
  percentToPage,
  textSnippet
} from './paginate'

describe('estimatePageChars', () => {
  it('按字号 × 行距 × 可用面积估算', () => {
    // 字号 20 → 字宽 20，行高 20×1.5=30；360/20=18 字/行，600/30=20 行 → 360
    expect(
      estimatePageChars({ fontSize: 20, lineSpacing: 1.5, width: 360, height: 600 })
    ).toBe(360)
  })

  it('结果被夹在合理区间内', () => {
    // 窗口极窄时每行放不下一个字，也要保住 120 的下限，不能漏出「每页 1 字」
    expect(estimatePageChars({ fontSize: 20, lineSpacing: 1.5, width: 10, height: 10 })).toBe(120)
    expect(estimatePageChars({ fontSize: 20, lineSpacing: 1.5, width: 0, height: 0 })).toBe(120)
    expect(estimatePageChars({ fontSize: 20, lineSpacing: 1.5, width: 99999, height: 99999 })).toBe(
      4000
    )
  })

  it('尺寸异常时不会返回 0 或负数', () => {
    expect(estimatePageChars({ fontSize: 0, lineSpacing: 0, width: 0, height: 0 })).toBeGreaterThan(0)
  })
})

describe('paginateText', () => {
  it('空文本返回一页空串，不产生空白页', () => {
    expect(paginateText('', 100)).toEqual([''])
    expect(paginateText('   \n\n ', 100)).toEqual([''])
  })

  it('短文本只有一页', () => {
    expect(paginateText('很短的一段话。', 100)).toEqual(['很短的一段话。'])
  })

  it('按自然段累积，不在段中断开', () => {
    const text = ['第一行', '第二行', '第三行'].join('\n')
    // 三段各 3 字。第一页装下「第一行\n第二行」（7 字），
    // 再加「\n第三行」要到 11 字 > 容量 8，于是断页
    expect(paginateText(text, 8)).toEqual(['第一行\n第二行', '第三行'])
  })

  it('整段放得下时不分页', () => {
    const text = ['第一行', '第二行', '第三行'].join('\n')
    expect(paginateText(text, 11)).toEqual(['第一行\n第二行\n第三行'])
  })

  it('单段超长时按容量硬切', () => {
    const pages = paginateText('a'.repeat(25), 10)
    expect(pages).toHaveLength(3)
    expect(pages[0]).toHaveLength(10)
    expect(pages[2]).toHaveLength(5)
  })

  it('切分后内容无损（去掉页间换行可还原）', () => {
    const text = Array.from({ length: 50 }, (_, i) => `第${i}段`).join('\n')
    const pages = paginateText(text, 30)
    expect(pages.join('\n')).toBe(text)
  })

  it('容量为 0 或负数时不死循环', () => {
    expect(paginateText('abc', 0)).toEqual(['a', 'b', 'c'])
    expect(paginateText('abc', -5)).toEqual(['a', 'b', 'c'])
  })

  // 关键回归：emoji 是代理对，按 UTF-16 码元切会劈出「半个字」
  it('不把代理对切开', () => {
    const pages = paginateText('🌌🌌🌌', 2)
    expect(pages).toEqual(['🌌🌌', '🌌'])
    for (const page of pages) {
      expect(page).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/)
    }
  })

  it('CRLF 归一为 LF', () => {
    expect(paginateText('a\r\nb', 100)).toEqual(['a\nb'])
  })
})

describe('percentToPage / pageToPercent', () => {
  it('往返换算稳定', () => {
    const pageCount = 10
    for (let page = 0; page < pageCount; page += 1) {
      expect(percentToPage(pageToPercent(page, pageCount), pageCount)).toBe(page)
    }
  })

  it('首尾分别为 0 与 1', () => {
    expect(pageToPercent(0, 5)).toBe(0)
    expect(pageToPercent(4, 5)).toBe(1)
  })

  it('单页时进度为 0（表示本章还没读，而不是「已读完」）', () => {
    expect(pageToPercent(0, 1)).toBe(0)
    expect(percentToPage(0.99, 1)).toBe(0)
  })

  it('越界输入被夹住', () => {
    expect(pageToPercent(-5, 5)).toBe(0)
    expect(pageToPercent(99, 5)).toBe(1)
    expect(percentToPage(-1, 5)).toBe(0)
    expect(percentToPage(2, 5)).toBe(4)
  })
})

describe('clampPageIndex', () => {
  it('夹在 [0, pageCount-1]', () => {
    expect(clampPageIndex(-3, 5)).toBe(0)
    expect(clampPageIndex(99, 5)).toBe(4)
    expect(clampPageIndex(2.7, 5)).toBe(2)
  })

  it('页数为 0 时返回 0', () => {
    expect(clampPageIndex(3, 0)).toBe(0)
  })
})

describe('textSnippet', () => {
  it('压掉换行与多余空白', () => {
    expect(textSnippet('  第一行\n\n  第二行  ')).toBe('第一行 第二行')
  })

  it('超长时截断并加省略号', () => {
    const snippet = textSnippet('一'.repeat(100), 10)
    expect(snippet).toBe(`${'一'.repeat(10)}…`)
  })

  it('短文本原样返回', () => {
    expect(textSnippet('短')).toBe('短')
  })
})
