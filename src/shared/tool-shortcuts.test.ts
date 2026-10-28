import { describe, expect, it } from 'vitest'
import { MAX_TOOL_FAVORITES, readToolIds, shortcutToolIds, validateToolIds } from './tool-shortcuts'

describe('工具快捷入口数据', () => {
  it('旧配置、损坏字段和重复 ID 可降级读取', () => {
    expect(readToolIds(null, 30)).toEqual([])
    expect(readToolIds(['json', 1, '__proto__', 'json', 'removed'], 30)).toEqual([
      'json',
      'removed'
    ])
  })
  it('主进程拒绝越界、空格、重复和非字符串 ID', () => {
    for (const value of [
      ['json', 'json'],
      [' json'],
      [''],
      [1],
      Array.from({ length: 31 }, (_, i) => `tool-${i}`)
    ])
      expect(() => validateToolIds(value, MAX_TOOL_FAVORITES)).toThrow()
  })
  it('快捷候选收藏优先，最近补齐且排除已删除工具', () => {
    expect(
      shortcutToolIds(['json', 'diff', 'uuid'], ['removed', 'json'], ['json', 'uuid', 'diff'])
    ).toEqual(['json', 'uuid', 'diff'])
  })
  it('最近展示上限在过滤过期 ID 之后应用，不让过期项占位置', () => {
    const known = Array.from({ length: 12 }, (_, i) => `tool-${i}`)
    expect(shortcutToolIds(known, [], ['removed', ...known])).toEqual(known.slice(0, 5))
  })
})
