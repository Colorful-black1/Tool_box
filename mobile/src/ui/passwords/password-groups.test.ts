import { describe, expect, it } from 'vitest'

import type { PasswordEntryView } from '../../shared-bridge'
import { duplicateKey, filterEntries, groupByLetter } from './password-groups'

function entry(input: {
  id: string
  title: string
  account?: string
  url?: string
  firstLetter?: string
  isFavorite?: boolean
}): PasswordEntryView {
  return {
    id: input.id,
    title: input.title,
    url: input.url ?? '',
    account: input.account ?? '',
    password: 'secret',
    remark: '',
    firstLetter: input.firstLetter ?? '#',
    isFavorite: input.isFavorite ?? false,
    createdAtMs: 1,
    updatedAtMs: 1,
    isDecryptable: true
  }
}

const GITHUB = entry({ id: '1', title: 'GitHub', account: 'octocat', url: 'https://github.com', firstLetter: 'G' })
const ALIPAY = entry({ id: '2', title: '支付宝', account: 'me@x.com', firstLetter: 'Z' })
const NUM = entry({ id: '3', title: '12306', account: 'me', firstLetter: '#' })
const STAR = entry({ id: '4', title: ' starred', account: 's', firstLetter: 'S', isFavorite: true })

const ALL = [GITHUB, ALIPAY, NUM, STAR]

describe('filterEntries', () => {
  it('空关键词返回全部', () => {
    expect(filterEntries(ALL, '', false)).toHaveLength(4)
    expect(filterEntries(ALL, '   ', false)).toHaveLength(4)
  })

  it('按名称搜索，大小写不敏感', () => {
    expect(filterEntries(ALL, 'github', false).map((item) => item.id)).toEqual(['1'])
    expect(filterEntries(ALL, 'GITHUB', false).map((item) => item.id)).toEqual(['1'])
  })

  it('按账号与网址搜索', () => {
    expect(filterEntries(ALL, 'octocat', false).map((item) => item.id)).toEqual(['1'])
    expect(filterEntries(ALL, 'https://github.com', false).map((item) => item.id)).toEqual(['1'])
  })

  it('收藏筛选与关键词叠加', () => {
    expect(filterEntries(ALL, '', true).map((item) => item.id)).toEqual(['4'])
    expect(filterEntries(ALL, 's', true).map((item) => item.id)).toEqual(['4'])
    expect(filterEntries(ALL, 'github', true)).toHaveLength(0)
  })

  it('搜不到时返回空数组而非 null', () => {
    expect(filterEntries(ALL, '不存在的关键词', false)).toEqual([])
  })
})

describe('groupByLetter', () => {
  it('按首字母分段并排序', () => {
    const sections = groupByLetter(ALL)
    expect(sections.map((section) => section.title)).toEqual(['#', 'G', 'S', 'Z'])
  })

  it('同一字母的条目落在同一段', () => {
    const sections = groupByLetter([
      entry({ id: 'a', title: '阿里', firstLetter: 'A' }),
      entry({ id: 'b', title: '爱奇艺', firstLetter: 'A' })
    ])
    expect(sections).toHaveLength(1)
    expect(sections[0]?.data.map((item) => item.id)).toEqual(['a', 'b'])
  })

  it('首字母为空时归到 #', () => {
    expect(groupByLetter([entry({ id: 'x', title: 'x', firstLetter: '' })])[0]?.title).toBe('#')
  })

  it('空输入返回空分段', () => {
    expect(groupByLetter([])).toEqual([])
  })
})

describe('duplicateKey', () => {
  it('与 savePasswordDrafts 的判定口径一致（标题 + 去空账号）', () => {
    expect(duplicateKey('GitHub', ' octocat ')).toBe('GitHub octocat')
    expect(duplicateKey('GitHub', '')).toBe('GitHub ')
  })
})
