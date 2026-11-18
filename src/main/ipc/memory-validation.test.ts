import { describe, expect, it } from 'vitest'

import {
  validateConfigPatch,
  validateMemoryQuery,
  validateMemorySaveInput,
  validateMemoryStateInput
} from './validation'

describe('长期记忆入参校验', () => {
  it('筛选：类型 / 状态走枚举，分页有上限', () => {
    expect(validateMemoryQuery(undefined)).toEqual({})
    expect(
      validateMemoryQuery({ query: ' git ', kind: 'constraint', status: 'active', limit: 20 })
    ).toEqual({
      query: 'git',
      kind: 'constraint',
      status: 'active',
      limit: 20
    })
    expect(validateMemoryQuery({ kind: 'all', status: 'all' })).toEqual({})
    expect(() => validateMemoryQuery({ kind: 'unknown' })).toThrow('记忆类型无效')
    expect(() => validateMemoryQuery({ limit: 0 })).toThrow()
    expect(() => validateMemoryQuery({ limit: 51 })).toThrow()
  })

  it('保存：标签数量与长度受限，置顶默认关闭', () => {
    expect(
      validateMemorySaveInput({
        kind: 'preference',
        title: '先给结论',
        body: '回答先给结论。',
        tags: ['回答风格', '协作']
      })
    ).toEqual({
      id: undefined,
      kind: 'preference',
      title: '先给结论',
      body: '回答先给结论。',
      tags: ['回答风格', '协作'],
      pinned: false
    })
    expect(() =>
      validateMemorySaveInput({
        kind: 'preference',
        title: '标题',
        body: '正文',
        tags: Array(9).fill('tag')
      })
    ).toThrow('记忆标签最多 8 项')
    expect(() => validateMemorySaveInput({ kind: 'preference', title: '标题', body: '' })).toThrow()
  })

  it('状态：至少带一个字段，状态值必须是枚举', () => {
    expect(validateMemoryStateInput({ id: 'm1', pinned: true })).toEqual({
      id: 'm1',
      pinned: true
    })
    expect(validateMemoryStateInput({ id: 'm1', status: 'archived' })).toEqual({
      id: 'm1',
      status: 'archived'
    })
    expect(() => validateMemoryStateInput({ id: 'm1' })).toThrow('没有需要更新的记忆状态')
    expect(() => validateMemoryStateInput({ id: 'm1', status: 'deleted' })).toThrow('记忆状态无效')
  })

  it('总开关必须是布尔值', () => {
    expect(validateConfigPatch({ memoryEnabled: false })).toEqual({ memoryEnabled: false })
    expect(() => validateConfigPatch({ memoryEnabled: 'false' })).toThrow(
      '长期记忆开关必须是布尔值'
    )
  })
})
