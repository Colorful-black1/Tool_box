import { describe, expect, it } from 'vitest'

import { parsePasswordText } from './password-text-parser'

describe('parsePasswordText', () => {
  it('parses a fixed-format entry with full-width colons', () => {
    const { entries } = parsePasswordText(
      ['名称：淘宝', '网址：https://taobao.com', '账号：user@x.com', '密码：Pass@123', '备注：主号'].join(
        '\n'
      )
    )

    expect(entries).toHaveLength(1)
    expect(entries[0]).toEqual({
      title: '淘宝',
      url: 'https://taobao.com',
      account: 'user@x.com',
      password: 'Pass@123',
      remark: '主号'
    })
  })

  it('splits multiple entries on blank lines', () => {
    const text = ['名称: A', '账号: a', '密码: 1', '', '名称: B', '账号: b', '密码: 2'].join('\n')
    const { entries } = parsePasswordText(text)

    expect(entries).toHaveLength(2)
    expect(entries[1].title).toBe('B')
  })

  it('falls back to account when the title is missing', () => {
    const { entries } = parsePasswordText('账号: only@account.com\n密码: 123')
    expect(entries[0].title).toBe('only@account.com')
  })

  it('uses 未命名条目 when nothing recognizable exists', () => {
    const { entries } = parsePasswordText('密码: 123456')
    expect(entries[0].title).toBe('未命名条目')
  })

  it('counts unrecognised lines as skipped', () => {
    const { entries, skipped } = parsePasswordText(
      ['名称: A', '账号: a', '这是一行无法识别的内容', '密码: 1'].join('\n')
    )
    expect(entries).toHaveLength(1)
    expect(skipped).toBe(1)
  })

  it('supports English labels case-insensitively', () => {
    const { entries } = parsePasswordText(
      ['Name: GitHub', 'Username: octocat', 'Password: gh123', 'Note: work'].join('\n')
    )
    expect(entries[0]).toMatchObject({
      title: 'GitHub',
      account: 'octocat',
      password: 'gh123',
      remark: 'work'
    })
  })

  it('treats a single bare line as the title', () => {
    const { entries } = parsePasswordText('淘宝')
    expect(entries[0].title).toBe('淘宝')
  })

  it('prefers longer labels over shorter prefixes', () => {
    const { entries } = parsePasswordText('网站名: Example\n用户名: u1')
    expect(entries[0].title).toBe('Example')
    expect(entries[0].account).toBe('u1')
  })
})