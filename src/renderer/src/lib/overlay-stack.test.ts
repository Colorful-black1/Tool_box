import { expect, it } from 'vitest'
import { pushOverlay } from './overlay-stack'

it('顶层退出后恢复下层，先卸载下层也不影响顶层', () => {
  const first = pushOverlay(),
    second = pushOverlay()
  expect(first.top()).toBe(false)
  expect(second.top()).toBe(true)
  first.dispose()
  expect(second.top()).toBe(true)
  second.dispose()
  const third = pushOverlay(),
    fourth = pushOverlay()
  fourth.dispose()
  expect(third.top()).toBe(true)
  third.dispose()
})
