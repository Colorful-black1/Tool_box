import { describe, expect, it } from 'vitest'

import {
  applyModelToggle,
  MAX_MODEL_NAME_CHARS,
  MAX_SELECTED_MODELS,
  normalizeModelList,
  resolveChatModels
} from './model-list'

describe('normalizeModelList', () => {
  it('非数组一律归一为空清单', () => {
    expect(normalizeModelList(undefined)).toEqual([])
    expect(normalizeModelList(null)).toEqual([])
    expect(normalizeModelList('model-a')).toEqual([])
    expect(normalizeModelList({ 0: 'model-a' })).toEqual([])
  })

  it('去空白、去重、丢掉空串', () => {
    expect(
      normalizeModelList([' model-a ', 'model-a', '', '   ', 'model-b'])
    ).toEqual(['model-a', 'model-b'])
  })

  it('丢掉非字符串项', () => {
    expect(normalizeModelList(['model-a', 42, null, { name: 'x' }])).toEqual(['model-a'])
  })

  it('超长模型名直接丢弃', () => {
    const tooLong = 'x'.repeat(MAX_MODEL_NAME_CHARS + 1)
    expect(normalizeModelList([tooLong, 'model-a'])).toEqual(['model-a'])
  })

  it('数量封顶', () => {
    const many = Array.from({ length: MAX_SELECTED_MODELS + 10 }, (_, index) => `model-${index}`)
    const result = normalizeModelList(many)
    expect(result).toHaveLength(MAX_SELECTED_MODELS)
    expect(result[0]).toBe('model-0')
  })
})

describe('resolveChatModels', () => {
  const fallback = ['preset-a', 'preset-b']

  it('当前模型永远排最前', () => {
    expect(resolveChatModels('model-x', ['model-a', 'model-b'], fallback)).toEqual([
      'model-x',
      'model-a',
      'model-b'
    ])
  })

  it('当前模型没被勾选时也保留', () => {
    expect(resolveChatModels('model-x', ['model-a'], fallback)).toEqual([
      'model-x',
      'model-a'
    ])
  })

  it('一个都没勾时回落到供应商内置推荐', () => {
    expect(resolveChatModels('model-x', [], fallback)).toEqual([
      'model-x',
      'preset-a',
      'preset-b'
    ])
    expect(resolveChatModels('model-x', undefined, fallback)).toEqual([
      'model-x',
      'preset-a',
      'preset-b'
    ])
  })

  it('去重且保持顺序', () => {
    expect(resolveChatModels('model-a', ['model-a', 'model-b', 'model-a'], fallback)).toEqual([
      'model-a',
      'model-b'
    ])
  })

  it('当前模型为空时只列勾选的清单', () => {
    expect(resolveChatModels('', ['model-a'], fallback)).toEqual(['model-a'])
  })
})

describe('applyModelToggle', () => {
  it('勾上一个还没在用的模型 → 当前模型切过去', () => {
    const result = applyModelToggle('model-a', ['model-a'], 'model-b')
    expect(result.selectedModels).toEqual(['model-a', 'model-b'])
    expect(result.model).toBe('model-b')
  })

  it('当前模型不在清单里时，勾上哪个就用哪个', () => {
    const result = applyModelToggle('model-a', [], 'model-b')
    expect(result.selectedModels).toEqual(['model-b'])
    expect(result.model).toBe('model-b')
  })

  it('当前模型还在清单里 → 勾新的也切过去（勾哪个用哪个）', () => {
    const result = applyModelToggle('model-a', ['model-a'], 'model-b')
    expect(result.selectedModels).toEqual(['model-a', 'model-b'])
    expect(result.model).toBe('model-b')
  })

  it('取消勾选当前模型 → 顺延到剩下的第一个', () => {
    const result = applyModelToggle('model-a', ['model-a', 'model-b'], 'model-a')
    expect(result.selectedModels).toEqual(['model-b'])
    expect(result.model).toBe('model-b')
  })

  it('取消勾选别的模型不影响当前模型', () => {
    const result = applyModelToggle('model-a', ['model-a', 'model-b'], 'model-b')
    expect(result.selectedModels).toEqual(['model-a'])
    expect(result.model).toBe('model-a')
  })

  it('取消勾选最后一个 → 清单为空，当前模型保持（下拉回落到内置推荐）', () => {
    const result = applyModelToggle('model-a', ['model-a'], 'model-a')
    expect(result.selectedModels).toEqual([])
    expect(result.model).toBe('model-a')
  })

  // 端到端语义：勾一个模型 → 当前模型切过去 → 下拉里只剩它 → 请求就用它
  it('勾一个模型后，当前模型与下拉都指向它', () => {
    const toggled = applyModelToggle('old-model', [], 'new-model')
    expect(toggled.model).toBe('new-model')
    expect(toggled.selectedModels).toEqual(['new-model'])
    expect(resolveChatModels(toggled.model, toggled.selectedModels, ['preset-a'])).toEqual([
      'new-model'
    ])
  })
})
