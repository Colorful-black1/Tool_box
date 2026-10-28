import { describe, expect, it } from 'vitest'
import { parseDshSessionRecord } from './dsh-runtime'

describe('DSH Desktop 会话缓存', () => {
  it('只提取标题和空白标记，结构不匹配时返回 null', () => {
    expect(
      parseDshSessionRecord({
        version: 7,
        record: {
          identity: { cwd: '/fixture' },
          rows: {
            title: { val: '桌面会话' },
            sessionListMetadata: { val: { blank: false, lastPromptAt: 123 } }
          }
        }
      })
    ).toEqual({ title: '桌面会话', blank: false, lastPromptAt: 123 })
    expect(
      parseDshSessionRecord({
        version: 7,
        record: {
          rows: {
            title: { val: null },
            sessionListMetadata: { val: { blank: true, lastPromptAt: null } }
          }
        }
      })
    ).toEqual({ title: '', blank: true, lastPromptAt: null })
    expect(parseDshSessionRecord(null)).toBeNull()
    expect(parseDshSessionRecord({ record: { rows: [] } })).toBeNull()
  })
})
