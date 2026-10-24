import { describe, expect, it } from 'vitest'
import { aggregateCost, aggregateTokens, modelLabel, money, normalizeTokens } from './normalize'

describe('原生 Token 语义', () => {
  it('Codex 输入包含缓存，输出包含推理，不重复相加', () => {
    expect(
      normalizeTokens(
        { input: 100, output: 20, cacheRead: 80, reasoning: 12, total: 120 },
        'included',
        'included',
        false
      )
    ).toEqual({ input: 20, output: 20, cacheRead: 80, cacheWrite: null, reasoning: 12, total: 120 })
  })
  it('Claude 的输入、缓存读写和输出是独立桶', () => {
    expect(
      normalizeTokens({ input: 10, output: 20, cacheRead: 100, cacheWrite: 50 }, 'separate').total
    ).toBe(180)
  })
  it('OpenCode 推理和缓存读取独立，未知写缓存关系不计入总量', () => {
    expect(
      normalizeTokens(
        { input: 10, output: 20, reasoning: 5, cacheRead: 100, cacheWrite: 50 },
        'separate',
        'separate',
        false
      ).total
    ).toBe(135)
  })
  it('缺失、负数和溢出计数不能伪装成零', () => {
    const a = normalizeTokens({ input: -1, output: 2, cacheRead: 0 }, 'included')
    expect(a.input).toBeNull()
    expect(a.total).toBeNull()
    expect(
      normalizeTokens({ input: Number.MAX_SAFE_INTEGER, output: 2 }, 'included').total
    ).toBeNull()
    expect(aggregateTokens([a]).input).toBeNull()
  })
  it('已知总量不表示未知分类字段可推算', () => {
    const value = normalizeTokens({ input: 100, output: 20, total: 120 }, 'included')
    expect(value.total).toBe(120)
    expect(value.input).toBeNull()
    expect(value.cacheRead).toBeNull()
  })
  it('模型对象与花费只保留可展示的值', () => {
    expect(modelLabel('{"id":"qwen3.8-27b","providerID":"p"}')).toBe('qwen3.8-27b')
    expect(modelLabel('fixture')).toBe('fixture')
    expect(modelLabel('{broken')).toBe('')
    expect(money('0.25')).toBe(0.25)
    expect(money(-1)).toBeNull()
    expect(money(Number.NaN)).toBeNull()
  })
  it('花费汇总区分已知值与缺失值，不把缺失当成免费', () => {
    expect(aggregateCost([1, null, 0.5])).toEqual({ usd: 1.5, reported: 2, total: 3 })
    expect(aggregateCost([null, null])).toEqual({ usd: null, reported: 0, total: 2 })
  })
})
