import { describe, expect, it } from 'vitest'

import { coverInitial, coverPalette } from './book-cover'

describe('coverPalette', () => {
  it('同一本书每次得到同一个色板', () => {
    expect(coverPalette('三体')).toBe(coverPalette('三体'))
  })

  it('不同书名大多落到不同色板', () => {
    const titles = ['三体', '活着', '红楼梦', '百年孤独', '银河系漫游指南', '沙丘']
    const used = new Set(titles.map((title) => coverPalette(title).base))
    expect(used.size).toBeGreaterThan(1)
  })
})

describe('coverInitial', () => {
  it('中文取第一个字', () => {
    expect(coverInitial('三体')).toBe('三')
  })

  it('英文首字母大写', () => {
    expect(coverInitial('dune')).toBe('D')
  })

  it('空标题给占位符', () => {
    expect(coverInitial('   ')).toBe('·')
  })
})
