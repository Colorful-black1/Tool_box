import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { REGEX_TIMEOUT_MS, runRegex } from './regex-runner'

/** 模拟线程边界，验证终止、超时与竞态，不在测试主线程运行恶意正则。 */
class WorkerStub {
  static instances: WorkerStub[] = []
  onmessage: Worker['onmessage'] = null
  onerror: Worker['onerror'] = null
  onmessageerror: Worker['onmessageerror'] = null
  postMessage = vi.fn()
  terminate = vi.fn()

  constructor() {
    WorkerStub.instances.push(this)
  }

  reply(data: unknown): void {
    this.onmessage?.call(this as unknown as Worker, { data } as MessageEvent)
  }
}

describe('可终止的正则任务', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    WorkerStub.instances = []
    vi.stubGlobal('Worker', WorkerStub)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('成功后返回结果，终止线程并清除计时器', async () => {
    const promise = runRegex('a', 'g', 'a', new AbortController().signal)
    const worker = WorkerStub.instances[0]
    expect(worker.postMessage).toHaveBeenCalledWith({ pattern: 'a', flags: 'g', text: 'a' })
    const result = { matches: [{ index: 0, length: 1, text: 'a' }] }
    worker.reply(result)
    expect(await promise).toEqual(result)
    expect(worker.terminate).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('线程无响应时超时终止，并清除事件处理器', async () => {
    const promise = runRegex('(a+)+$', '', 'a'.repeat(32) + '!', new AbortController().signal)
    vi.advanceTimersByTime(REGEX_TIMEOUT_MS)
    expect((await promise).error).toContain('超时')
    const worker = WorkerStub.instances[0]
    expect(worker.terminate).toHaveBeenCalledOnce()
    expect(worker.onmessage).toBeNull()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('取消任务后旧结果不再回传，也不显示错误', async () => {
    const controller = new AbortController()
    const promise = runRegex('a', 'g', 'a', controller.signal)
    controller.abort()
    WorkerStub.instances[0].reply({ matches: [], error: '过期结果' })
    expect(await promise).toEqual({ matches: [] })
    expect(WorkerStub.instances[0].terminate).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('已取消或表达式为空时不创建线程', async () => {
    const controller = new AbortController()
    controller.abort()
    expect(await runRegex('a', '', '', controller.signal)).toEqual({ matches: [] })
    expect(await runRegex('', '', '', new AbortController().signal)).toEqual({ matches: [] })
    expect(WorkerStub.instances).toHaveLength(0)
  })

  it('线程不可用时返回中文错误，不回落主线程', async () => {
    vi.stubGlobal('Worker', undefined)
    expect((await runRegex('a', '', 'a', new AbortController().signal)).error).toContain('无法启动')
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each(['onerror', 'onmessageerror'] as const)('%s 发生时返回提示并释放线程', async (kind) => {
    const promise = runRegex('a', '', 'a', new AbortController().signal)
    const worker = WorkerStub.instances[0]
    if (kind === 'onerror') {
      const event = { preventDefault: vi.fn() } as unknown as ErrorEvent
      worker.onerror?.call(worker as unknown as Worker, event)
      expect(event.preventDefault).toHaveBeenCalledOnce()
    } else {
      worker.onmessageerror?.call(worker as unknown as Worker, {} as MessageEvent)
    }
    expect((await promise).error).toBeTruthy()
    expect(worker.terminate).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('发送输入失败时释放线程', async () => {
    const create = vi.fn(function () {
      const worker = new WorkerStub()
      worker.postMessage.mockImplementationOnce(() => {
        throw new Error('transfer failure')
      })
      return worker
    })
    vi.stubGlobal('Worker', create)
    expect((await runRegex('a', '', 'a', new AbortController().signal)).error).toContain('无法开始')
    expect(WorkerStub.instances[0].terminate).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })
})
