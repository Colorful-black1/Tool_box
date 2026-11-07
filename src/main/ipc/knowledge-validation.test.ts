import { describe, expect, it } from 'vitest'

import {
  validateKbCategory,
  validateKbDocumentId,
  validateKbDocumentInput,
  validateKbImportInput,
  validateKbListInput,
  validateKbSearchInput
} from './validation'

describe('知识库入参校验', () => {
  it('类别只接受小写字母、数字与连字符', () => {
    expect(validateKbCategory('work')).toBe('work')
    expect(validateKbCategory('personal')).toBe('personal')
    expect(validateKbCategory('')).toBeUndefined()
    for (const value of ['Work', '工作', 'a'.repeat(21), '../x', 'a b'])
      expect(() => validateKbCategory(value)).toThrow()
  })

  it('导入只接受绝对路径，并有单次数量上限', () => {
    const path = 'C:\\资料\\a.md'
    expect(validateKbImportInput({ paths: [path], category: 'work' })).toEqual({
      paths: [path],
      category: 'work'
    })
    expect(() => validateKbImportInput({ paths: ['docs/a.md'] })).toThrow('绝对路径')
    expect(() => validateKbImportInput({ paths: Array(51).fill(path) })).toThrow('50')
    expect(() => validateKbImportInput({ paths: [path], category: 'Work' })).toThrow()
  })

  it('检索词、类别、模式与条数都有边界', () => {
    expect(validateKbSearchInput({ query: '', mode: 'keyword', topK: 8 })).toMatchObject({
      query: '',
      mode: 'keyword',
      topK: 8
    })
    for (const patch of [
      { query: 'x'.repeat(201) },
      { mode: 'fuzzy' },
      { topK: 0 },
      { topK: 21 },
      { category: 'x y' }
    ]) {
      expect(() => validateKbSearchInput({ query: '部署', ...patch })).toThrow()
    }
  })

  it('列表筛选与定位 ID 只接受白名单值', () => {
    expect(validateKbListInput()).toEqual({})
    expect(
      validateKbListInput({ category: 'personal', status: 'failed', query: '部署' })
    ).toEqual({ category: 'personal', status: 'failed', query: '部署' })
    expect(() => validateKbListInput({ status: 'mystery' })).toThrow()
    expect(() => validateKbListInput({ query: 'x'.repeat(121) })).toThrow()

    expect(validateKbDocumentId('doc-1_2')).toBe('doc-1_2')
    expect(() => validateKbDocumentId('../x')).toThrow()
    expect(() => validateKbDocumentId('')).toThrow()
    expect(validateKbDocumentInput({ documentId: 'doc1', chunkId: 'chunk-1' })).toEqual({
      documentId: 'doc1',
      chunkId: 'chunk-1'
    })
    expect(validateKbDocumentInput({ documentId: 'doc1', chunkId: '' })).toEqual({
      documentId: 'doc1'
    })
  })
})
