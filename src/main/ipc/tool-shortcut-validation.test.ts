import { describe, expect, it } from 'vitest'
import { validateConfigPatch } from './validation'

describe('工具快捷偏好配置校验', () => {
  it('新增字段与原排序保持独立', () => {
    expect(
      validateConfigPatch({
        toolFavorites: ['json'],
        toolRecent: ['uuid'],
        toolOrder: ['uuid', 'json']
      })
    ).toEqual({ toolFavorites: ['json'], toolRecent: ['uuid'], toolOrder: ['uuid', 'json'] })
  })
  it('严格拒绝重复、越界及原型污染形式的标识', () => {
    for (const patch of [
      { toolFavorites: ['json', 'json'] },
      { toolRecent: ['__proto__'] },
      { toolRecent: Array.from({ length: 21 }, (_, i) => `tool-${i}`) }
    ])
      expect(() => validateConfigPatch(patch)).toThrow()
  })
})
