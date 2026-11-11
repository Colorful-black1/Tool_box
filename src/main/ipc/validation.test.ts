import { describe, expect, it } from 'vitest'

import { DEFAULT_APP_APPEARANCE, readAppAppearance, resolveAppTheme } from '../../shared/appearance'
import { validateConfigPatch, validateModelContextLimits } from './validation'
import { defaultPromptTemplates } from '../../shared/prompt-tools'

describe('模型上下文窗口校验', () => {
  it('接受 manual / api 与 null，并拒绝越界值', () => {
    expect(
      validateModelContextLimits({
        'model-a': { tokens: 131_072, source: 'api' },
        'model-b': { tokens: 1_048_576, source: 'manual' },
        'model-c': null
      })
    ).toEqual({
      'model-a': { tokens: 131_072, source: 'api' },
      'model-b': { tokens: 1_048_576, source: 'manual' },
      'model-c': null
    })
    expect(() =>
      validateModelContextLimits({ 'model-a': { tokens: 128, source: 'api' } })
    ).toThrow('4000')
    expect(() =>
      validateModelContextLimits({ 'model-a': { tokens: 131_072, source: 'learned' } })
    ).toThrow()
    expect(() => validateModelContextLimits({ '../bad': { tokens: 131_072, source: 'api' } })).toThrow()
  })

  it('自动压缩开关必须是布尔值', () => {
    expect(validateConfigPatch({ contextAutoCompact: false })).toEqual({
      contextAutoCompact: false
    })
    expect(() => validateConfigPatch({ contextAutoCompact: 'false' })).toThrow()
  })
})

describe('桌面外观配置', () => {
  it('工具顺序逐项校验且保持其他配置', () => {
    expect(validateConfigPatch({ toolOrder: ['uuid', 'json'], fontSize: 23 })).toEqual({
      toolOrder: ['uuid', 'json'],
      fontSize: 23
    })
    for (const toolOrder of [
      null,
      'json',
      ['json', 'json'],
      ['../json'],
      [1],
      ['x'.repeat(65)],
      Array(101).fill('json')
    ]) {
      expect(() => validateConfigPatch({ toolOrder })).toThrow()
    }
    expect(validateConfigPatch({ toolOrder: [] })).toEqual({ toolOrder: [] })
  })
  it('同时校验模板和外观，并保留其他配置', () => {
    const promptTemplates = defaultPromptTemplates()
    expect(
      validateConfigPatch({ appearance: DEFAULT_APP_APPEARANCE, promptTemplates, fontSize: 23 })
    ).toEqual({ appearance: DEFAULT_APP_APPEARANCE, promptTemplates, fontSize: 23 })
    expect(() => validateConfigPatch({ promptTemplates: 'invalid' })).toThrow('模板')
  })
  it('兼容旧配置与损坏的缓存', () => {
    for (const value of [undefined, null, [], 'paper', { theme: 'unknown' }]) {
      expect(readAppAppearance(value)).toEqual(DEFAULT_APP_APPEARANCE)
    }
    expect(readAppAppearance({ theme: 'paper', backgroundMotion: 'false' })).toEqual({
      theme: 'paper',
      backgroundMotion: true
    })
  })

  it('跟随系统只解析应用主题，不覆盖保存的偏好', () => {
    expect(resolveAppTheme('system', true)).toBe('graphite')
    expect(resolveAppTheme('system', false)).toBe('paper')
    expect(resolveAppTheme('starry', false)).toBe('starry')
    expect(resolveAppTheme('paper', true)).toBe('paper')
  })

  it('保留阅读配置，仅存储已知的外观字段', () => {
    expect(
      validateConfigPatch({
        themeIndex: 3,
        appearance: { theme: 'paper', backgroundMotion: false, extra: 'ignored' }
      })
    ).toEqual({ themeIndex: 3, appearance: { theme: 'paper', backgroundMotion: false } })
    expect(validateConfigPatch({ fontSize: 20 })).toEqual({ fontSize: 20 })
  })

  it.each([
    null,
    [],
    'paper',
    { theme: 'unknown', backgroundMotion: true },
    { theme: 'starry' },
    { theme: 'paper', backgroundMotion: 'false' }
  ])('拒绝非法的外观入参 %j', (appearance) => {
    expect(() => validateConfigPatch({ appearance })).toThrow()
  })
})
