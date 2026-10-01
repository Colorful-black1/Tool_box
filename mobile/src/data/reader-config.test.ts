import { describe, expect, it } from 'vitest'

import { READER_THEMES } from '../shared-bridge'
import {
  DEFAULT_READER_PREFS,
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  LINE_SPACING_MAX,
  LINE_SPACING_MIN,
  themeOf,
  toReaderPrefs
} from './reader-config'

describe('toReaderPrefs', () => {
  it('无配置时返回默认值', () => {
    expect(toReaderPrefs(null)).toEqual(DEFAULT_READER_PREFS)
  })

  it('保留合法值', () => {
    const prefs = toReaderPrefs({
      fontSize: 22,
      lineSpacing: 1.8,
      fontFamily: 'serif',
      themeIndex: 2,
      nightMode: true,
      pageMode: 'scroll'
    })
    expect(prefs).toEqual({
      fontSize: 22,
      lineSpacing: 1.8,
      fontFamily: 'serif',
      themeIndex: 2,
      nightMode: true,
      pageMode: 'scroll'
    })
  })

  // kv 里的值可能来自旧版本或被手工改坏，字号一旦是 0 或负数会渲染出空白页
  it('越界的字号 / 行距被夹回区间', () => {
    const prefs = toReaderPrefs({ fontSize: 999, lineSpacing: 99, themeIndex: -5 })
    expect(prefs.fontSize).toBe(FONT_SIZE_MAX)
    expect(prefs.lineSpacing).toBe(LINE_SPACING_MAX)

    const low = toReaderPrefs({ fontSize: -10, lineSpacing: 0 })
    expect(low.fontSize).toBe(FONT_SIZE_MIN)
    expect(low.lineSpacing).toBe(LINE_SPACING_MIN)
  })

  it('主题下标夹在 READER_THEMES 范围内', () => {
    expect(toReaderPrefs({ themeIndex: 999 }).themeIndex).toBe(READER_THEMES.length - 1)
    expect(toReaderPrefs({ themeIndex: -1 }).themeIndex).toBe(0)
  })

  it('非数值 / NaN 回落默认值', () => {
    const prefs = toReaderPrefs({ fontSize: '20', lineSpacing: Number.NaN, themeIndex: null })
    expect(prefs.fontSize).toBe(DEFAULT_READER_PREFS.fontSize)
    expect(prefs.lineSpacing).toBe(DEFAULT_READER_PREFS.lineSpacing)
    expect(prefs.themeIndex).toBe(DEFAULT_READER_PREFS.themeIndex)
  })

  it('非字符串 fontFamily 回落默认值', () => {
    expect(toReaderPrefs({ fontFamily: 123 }).fontFamily).toBe(DEFAULT_READER_PREFS.fontFamily)
  })

  it('非布尔 nightMode 回落默认值', () => {
    expect(toReaderPrefs({ nightMode: 'yes' }).nightMode).toBe(DEFAULT_READER_PREFS.nightMode)
  })

  // 桌面端的 'cover' 依赖图片层与手势层，手机端没实现，不能留一个选不出来的中间态
  it("'cover' 与非法值都归一到左右翻页", () => {
    expect(toReaderPrefs({ pageMode: 'cover' }).pageMode).toBe('horizontal')
    expect(toReaderPrefs({ pageMode: 'nope' }).pageMode).not.toBe('nope')
    expect(toReaderPrefs({ pageMode: undefined }).pageMode).toBe(DEFAULT_READER_PREFS.pageMode)
  })
})

describe('themeOf', () => {
  it('夜间模式优先于主题下标', () => {
    const theme = themeOf({ ...DEFAULT_READER_PREFS, themeIndex: 1, nightMode: true })
    expect(theme.background).toBe('#121212')
  })

  it('未开夜间模式时按主题下标取色', () => {
    READER_THEMES.forEach((expected, index) => {
      expect(themeOf({ ...DEFAULT_READER_PREFS, themeIndex: index, nightMode: false })).toEqual(
        expected
      )
    })
  })

  it('主题下标越界时回退到有效主题而不是崩掉', () => {
    const theme = themeOf({ ...DEFAULT_READER_PREFS, themeIndex: 99, nightMode: false })
    expect(READER_THEMES.map((item) => item.name)).toContain(theme.name)
  })
})
