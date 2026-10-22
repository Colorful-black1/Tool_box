import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { usePasswordAiStore } from './password-ai-store'

const importAi = vi.fn<() => Promise<null>>()
const stopAi = vi.fn(async () => {})
beforeEach(() => {
  vi.stubGlobal('window', {
    toolbox: { passwords: { importAi }, tools: { stopAi, onAiOutput: vi.fn() } }
  })
  usePasswordAiStore.getState().clear()
  importAi.mockReset()
  stopAi.mockClear()
})
afterEach(() => vi.unstubAllGlobals())

it('预览与最终导入结果隔离，关闭后忽略旧片段及失败', async () => {
  let reject!: (error: Error) => void
  importAi.mockImplementationOnce(
    () =>
      new Promise((_resolve, fail) => {
        reject = fail
      })
  )
  const pending = usePasswordAiStore.getState().start()
  const requestId = usePasswordAiStore.getState().requestId!
  const event = {
    kind: 'password-import' as const,
    requestId,
    receivedChars: 20,
    entries: [{ title: '合成', account: '', url: '', hasPassword: true }]
  }
  usePasswordAiStore.getState().receive(event)
  expect(usePasswordAiStore.getState().entries).toHaveLength(1)
  expect(usePasswordAiStore.getState().drafts).toBeNull()
  usePasswordAiStore.getState().clear()
  expect(stopAi).toHaveBeenCalledWith(requestId)
  usePasswordAiStore.getState().receive(event)
  reject(new Error('合成底层错误'))
  await pending
  expect(usePasswordAiStore.getState().entries).toEqual([])
  expect(usePasswordAiStore.getState().error).toBe('')
})
