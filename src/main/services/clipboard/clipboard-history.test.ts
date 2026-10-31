import { afterEach, describe, expect, it, vi } from 'vitest'
import { ClipboardHistoryService } from './clipboard-history'

describe('内存剪贴板历史', async () => {
  const services: ClipboardHistoryService[] = []
  afterEach(() => {
    services.forEach((service) => service.dispose())
    vi.useRealTimers()
  })
  function setup(): {
    service: ClipboardHistoryService
    copy(text: string): Promise<void>
    advance(ms: number): Promise<void>
  } {
    let text = '开启前的内容'
    let now = 1000
    const service = new ClipboardHistoryService(
      () => text,
      () => true,
      vi.fn(),
      () => now
    )
    services.push(service)
    return {
      service,
      copy: async (value) => {
        text = value
        now += 1
        await service.poll()
      },
      advance: async (ms) => {
        now += ms
        await service.poll()
      }
    }
  }
  it('默认关闭，不追溯旧内容，去连续重复与空白并按时间倒序', async () => {
    const { service, copy } = setup()
    await copy('不采集')
    expect(service.snapshot().entries).toEqual([])
    await service.configure({ enabled: true, keywords: [], prefixes: [] })
    await copy('不采集')
    await copy('a')
    await copy('a')
    await copy('b')
    await copy('   ')
    await copy('c')
    expect(service.snapshot().entries.map((item) => item.text)).toEqual(['c', 'b', 'a'])
  })
  it('应用复制的哈希即使关闭时也保护，支持忽略、暂停与关闭', async () => {
    const { service, copy, advance } = setup()
    service.excludeCopy('secret')
    await service.configure({ enabled: true, keywords: ['token'], prefixes: ['private:'] })
    await copy('other')
    await copy('secret')
    await copy('has token')
    await copy('private: abc')
    service.pause()
    await copy('paused')
    await advance(30 * 60_000)
    await copy('resumed')
    await service.configure({ enabled: false, keywords: [], prefixes: [] })
    await copy('disabled')
    expect(service.snapshot().entries.map((item) => item.text)).toEqual(['resumed', 'other'])
  })
  it('200条上限保护固定项，长文本截断并标记，支持删除与清空', async () => {
    const { service, copy } = setup()
    await service.configure({ enabled: true, keywords: [], prefixes: [] })
    await copy('pinned')
    const id = service.snapshot().entries[0].id
    service.pin(id, true)
    for (let i = 0; i < 205; i += 1) await copy(String(i))
    expect(service.snapshot().entries).toHaveLength(200)
    expect(service.snapshot().entries[0].id).toBe(id)
    await copy('a'.repeat(10_001))
    expect(service.snapshot().entries[1]).toMatchObject({
      text: 'a'.repeat(10_000),
      truncated: true
    })
    service.clear(id)
    expect(service.snapshot().entries).toHaveLength(199)
    service.clear()
    expect(service.snapshot().entries).toEqual([])
  })
  it('没有窗口时不采集，读失败不抛出原始错误', async () => {
    const service = new ClipboardHistoryService(
      () => {
        throw new Error('private-content')
      },
      () => false,
      vi.fn()
    )
    services.push(service)
    await service.configure({ enabled: true, keywords: [], prefixes: [] })
    await service.poll()
    expect(JSON.stringify(service.snapshot())).not.toContain('private-content')
    expect(service.snapshot().entries).toEqual([])
  })
  it('异步读取不会重叠，关闭后抵达的旧文本不会被记录', async () => {
    let resolveRead: (value: string) => void = () => {}
    const read = vi
      .fn<() => string | Promise<string>>()
      .mockReturnValueOnce('before')
      .mockImplementation(
        () =>
          new Promise<string>((resolve) => {
            resolveRead = resolve
          })
      )
    const service = new ClipboardHistoryService(read, () => true, vi.fn())
    services.push(service)
    await service.configure({ enabled: true, keywords: [], prefixes: [] })
    const pending = service.poll()
    await service.poll()
    expect(read).toHaveBeenCalledTimes(2)
    await service.configure({ enabled: false, keywords: [], prefixes: [] })
    resolveRead('arrives-after-disabled')
    await pending
    expect(service.snapshot().entries).toEqual([])
  })
  it('开启读取与应用复制并发时仍启动轮询，清空后不复活旧读取', async () => {
    vi.useFakeTimers()
    let resolveRead: (text: string) => void = () => {}
    const read = vi.fn<() => Promise<string>>(
      () =>
        new Promise((resolve) => {
          resolveRead = resolve
        })
    )
    const service = new ClipboardHistoryService(read, () => true, vi.fn())
    services.push(service)
    const enabling = service.configure({ enabled: true, keywords: [], prefixes: [] })
    service.excludeCopy('sensitive-copy')
    resolveRead('old-before-enable')
    await enabling
    expect(vi.getTimerCount()).toBe(1)
    const pending = service.poll()
    service.clear()
    resolveRead('before-clear')
    await pending
    expect(service.snapshot().entries).toEqual([])
    const next = service.poll()
    resolveRead('after-clear')
    await next
    expect(service.snapshot().entries.map((entry) => entry.text)).toEqual(['after-clear'])
  })
})
