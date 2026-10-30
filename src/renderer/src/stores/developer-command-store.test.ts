import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useDeveloperCommandStore } from './developer-command-store'
import { EMPTY_COMMAND_LIBRARY } from '../../../shared/developer-commands'
import type { ToolboxBridge } from '@shared/bridge'

const input = {
  title: 'a',
  command: 'b',
  category: '其他',
  description: '',
  tags: [],
  shell: 'any' as const,
  risk: 'read' as const,
  expectedRevision: 0
}
afterEach(() => vi.unstubAllGlobals())
beforeEach(() => {
  useDeveloperCommandStore.setState({
    snapshot: structuredClone(EMPTY_COMMAND_LIBRARY),
    ready: false,
    loading: false,
    saving: false,
    error: ''
  })
})
describe('命令库写入状态', () => {
  it('无桥接或读失败时禁止保存，不用空库覆盖', async () => {
    vi.stubGlobal('window', {})
    await useDeveloperCommandStore.getState().load()
    expect(await useDeveloperCommandStore.getState().save(input)).toBe(false)
    expect(useDeveloperCommandStore.getState().error).toContain('桥接')
    vi.stubGlobal('window', {
      toolbox: {
        developerCommands: { read: vi.fn().mockRejectedValue(new Error('原记录保留')) }
      } as unknown as ToolboxBridge
    })
    await useDeveloperCommandStore.getState().load()
    expect(useDeveloperCommandStore.getState().ready).toBe(false)
  })
  it('并发写入被拒绝，读取不能用旧响应覆盖正在保存的快照', async () => {
    let finish!: (value: typeof EMPTY_COMMAND_LIBRARY) => void
    const save = vi.fn(
      () =>
        new Promise<typeof EMPTY_COMMAND_LIBRARY>((resolve) => {
          finish = resolve
        })
    )
    const read = vi.fn().mockResolvedValue(EMPTY_COMMAND_LIBRARY)
    vi.stubGlobal('window', { toolbox: { developerCommands: { read, save } } })
    await useDeveloperCommandStore.getState().load()
    const first = useDeveloperCommandStore.getState().save(input)
    expect(await useDeveloperCommandStore.getState().save(input)).toBe(false)
    await useDeveloperCommandStore.getState().load()
    finish({ ...EMPTY_COMMAND_LIBRARY, revision: 1 })
    expect(await first).toBe(true)
    expect(read).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledTimes(1)
    expect(useDeveloperCommandStore.getState().snapshot.revision).toBe(1)
  })
})
