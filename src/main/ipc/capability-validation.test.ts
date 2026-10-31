import { describe, expect, it } from 'vitest'
import { validateClipboardConfig, validateClipboardPin } from './validation'

describe('能力批次 IPC 校验', () => {
  it('拒绝非布尔启用状态、非数组规则、过长或过多规则', () => {
    const valid = { enabled: true, keywords: [], prefixes: [] }
    expect(validateClipboardConfig(valid)).toEqual(valid)
    expect(() => validateClipboardConfig({ ...valid, enabled: 'true' })).toThrow()
    expect(() => validateClipboardConfig({ ...valid, keywords: 'secret' })).toThrow()
    expect(() =>
      validateClipboardConfig({ ...valid, prefixes: Array(51).fill('prefix') })
    ).toThrow()
    expect(() => validateClipboardConfig({ ...valid, keywords: ['x'.repeat(201)] })).toThrow()
    expect(() => validateClipboardConfig({ ...valid, keywords: [null] })).toThrow()
  })
  it('固定入参不接受空标识与字符串布尔值', () => {
    expect(validateClipboardPin({ id: 'entry', pinned: false })).toEqual({
      id: 'entry',
      pinned: false
    })
    expect(() => validateClipboardPin({ id: '', pinned: true })).toThrow()
    expect(() => validateClipboardPin({ id: 'entry', pinned: 'false' })).toThrow()
  })
})
