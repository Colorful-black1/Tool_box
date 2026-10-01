import { describe, expect, it } from 'vitest'

import { parseAiResponse, parseDateMs } from './password-ai-service'

describe('parseAiResponse', () => {
  it('parses a bare JSON array', () => {
    const raw =
      '[{"name":"谷歌账号","username":"user@gmail.com","password":"Pass@123","url":"","remark":"工作"}]'
    const entries = parseAiResponse(raw)

    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      title: '谷歌账号',
      account: 'user@gmail.com',
      password: 'Pass@123',
      remark: '工作'
    })
  })

  it('tolerates Markdown code fences and surrounding prose', () => {
    const raw = [
      '好的，以下是识别结果：',
      '```json',
      '[{"name":"微信","username":"wx_test","password":"abc888"}]',
      '```'
    ].join('\n')
    const entries = parseAiResponse(raw)

    expect(entries).toHaveLength(1)
    expect(entries[0].title).toBe('微信')
  })

  it('accepts alternative field aliases', () => {
    const raw = '[{"title":"GitHub","account":"octocat","pass":"gh1","website":"github.com","note":"n"}]'
    const entries = parseAiResponse(raw)

    expect(entries[0]).toMatchObject({
      title: 'GitHub',
      account: 'octocat',
      password: 'gh1',
      url: 'github.com',
      remark: 'n'
    })
  })

  it('drops entries without a title and account', () => {
    const raw = '[{"password":"orphan"},{"name":"keep","password":"p"}]'
    const entries = parseAiResponse(raw)

    expect(entries).toHaveLength(1)
    expect(entries[0].title).toBe('keep')
  })

  it('throws when no array is present', () => {
    expect(() => parseAiResponse('没有 JSON')).toThrow('不是有效的 JSON 数组')
  })
})

describe('parseDateMs', () => {
  it('parses Chinese dates', () => {
    const ms = parseDateMs('2024年1月15日')
    expect(ms).toBe(new Date(2024, 0, 15).getTime())
  })

  it('parses slash and dot separated dates', () => {
    expect(parseDateMs('2024/01/15')).toBe(new Date(2024, 0, 15).getTime())
    expect(parseDateMs('2024.01.15')).toBe(new Date(2024, 0, 15).getTime())
  })

  it('returns undefined for invalid input', () => {
    expect(parseDateMs('not a date')).toBeUndefined()
    expect(parseDateMs(undefined)).toBeUndefined()
  })
})