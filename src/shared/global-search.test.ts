import { describe, expect, it } from 'vitest'

import { searchAll } from './global-search'
import type { SearchSource } from './global-search'

const SOURCES: SearchSource[] = [
  { kind: 'book', id: 'b1', title: '凡人修仙传', subtitle: '忘语', keywords: '韩立 元婴' },
  { kind: 'book', id: 'b2', title: '星际穿越指南', subtitle: '佚名' },
  { kind: 'note', id: 'n1', title: '购物清单', subtitle: '昨天', keywords: '牛奶 鸡蛋 酱油' },
  { kind: 'password', id: 'p1', title: 'GitHub', subtitle: 'https://github.com' },
  { kind: 'command', id: 'c1', title: '切换到书架' }
]

describe('searchAll', () => {
  it('空查询没有结果', () => {
    expect(searchAll('', SOURCES)).toEqual([])
    expect(searchAll('   ', SOURCES)).toEqual([])
  })

  it('标题前缀命中排在最前', () => {
    const hits = searchAll('凡', SOURCES)
    expect(hits[0].id).toBe('b1')
  })

  it('能搜到副标题', () => {
    const hits = searchAll('https', SOURCES)
    expect(hits[0].id).toBe('p1')
    expect(hits[0].matched).toBe('subtitle')
  })

  it('能搜到正文关键词', () => {
    const hits = searchAll('牛奶', SOURCES)
    expect(hits[0].id).toBe('n1')
    expect(hits[0].matched).toBe('keywords')
  })

  it('多个关键词是「与」关系', () => {
    expect(searchAll('凡人 修仙', SOURCES).map((hit) => hit.id)).toEqual(['b1'])
    expect(searchAll('凡人 不存在', SOURCES)).toEqual([])
  })

  it('同分时按类型顺序（命令优先）', () => {
    const hits = searchAll('切换', [
      { kind: 'book', id: 'b', title: '切换' },
      { kind: 'command', id: 'c', title: '切换' }
    ])
    expect(hits.map((hit) => hit.id)).toEqual(['c', 'b'])
  })

  it('保留候选对象的额外字段', () => {
    const hits = searchAll('书架', [
      { kind: 'command', id: 'c', title: '切换到书架', action: 'go-shelf' }
    ])
    expect(hits[0].action).toBe('go-shelf')
  })

  it('结果数量受 limit 限制', () => {
    const many = Array.from({ length: 50 }, (_, index) => ({
      kind: 'book' as const,
      id: `b${index}`,
      title: `书 ${index}`
    }))
    expect(searchAll('书', many, 10)).toHaveLength(10)
  })
})
