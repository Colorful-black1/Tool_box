import { describe, expect, it } from 'vitest'

import { TITLE_BAR_HEIGHT, titleBarPalette } from './appearance'

describe('titleBarPalette', () => {
  it('matches the three theme surfaces', () => {
    expect(titleBarPalette('starry')).toEqual({ color: '#080b16', symbolColor: '#e8c98a' })
    expect(titleBarPalette('graphite')).toEqual({ color: '#171a1f', symbolColor: '#d5bf97' })
    expect(titleBarPalette('paper')).toEqual({ color: '#f3f0e8', symbolColor: '#282a31' })
    expect(TITLE_BAR_HEIGHT).toBe(32)
  })
})
