import { describe, expect, it, vi } from 'vitest'
import type { CodingAgentId } from '../../../shared/coding-agents'
import { IPC } from '../../../shared/ipc-contract'
import { CodingAgentService, unavailableRuntime } from './coding-agent-service'
import type { CodingAgentAdapter, NativeCodingEvent, NativeCodingSession } from './adapter'

function fixture(id: CodingAgentId) {
  const listeners = new Set<(event: NativeCodingEvent) => void>()
  const native: NativeCodingSession = {
    id: 'same-native-id',
    title: '原生名称',
    directory: '/fixture/project',
    status: 'ready',
    messages: [],
    tools: [],
    options: [],
    approvals: [],
    error: ''
  }
  const emit = (session: NativeCodingSession): void => {
    for (const listener of listeners)
      listener({ kind: 'session', session: structuredClone(session) })
  }
  const info = { ...unavailableRuntime(id), executablePath: `/fixture/${id}.exe`, available: true }
  const adapter: CodingAgentAdapter = {
    id,
    inspect: vi.fn(async () => ({ ...info })),
    selectExecutable: vi.fn(async () => ({ ...info })),
    connect: vi.fn(async () => {
      info.connected = true
      info.canLoadSession = true
      return { ...info }
    }),
    disconnect: vi.fn(() => {
      info.connected = false
      for (const listener of listeners) listener({ kind: 'connection', connected: false })
    }),
    listSessions: vi.fn(async () => [{ id: native.id, title: native.title }]),
    openSession: vi.fn(async () => structuredClone(native)),
    setOption: vi.fn(async () => structuredClone(native)),
    send: vi.fn(() => emit({ ...native, status: 'running' })),
    stop: vi.fn(() => emit({ ...native, status: 'ready' })),
    approve: vi.fn(),
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    }
  }
  return { adapter, native, emit }
}

describe('统一编程运行时边界', () => {
  it('窗口销毁先清除所有者，断连终态不再发送到原窗口', async () => {
    const f = fixture('claude')
    const service = new CodingAgentService([f.adapter])
    await service.connect('claude', 1, '/fixture/project')
    const session = await service.openSession('claude', 1)
    await service.send('claude', 1, session.id, '合成任务')
    const notify = vi.fn()
    service.subscribe(notify)
    service.releaseOwner(1)
    expect(f.adapter.disconnect).toHaveBeenCalled()
    expect(notify).not.toHaveBeenCalled()
    expect((await service.inspect('claude', 2)).connected).toBe(false)
    await service.connect('claude', 2, '/fixture/project')
    expect((await service.inspect('claude', 2)).connected).toBe(true)
    service.dispose()
  })
  it('退出清理先解除订阅，不向已经关闭的窗口广播断开事件', async () => {
    const code = fixture('claude')
    const desktop = fixture('claude-desktop')
    const service = new CodingAgentService([code.adapter, desktop.adapter])
    await service.connect('claude', 1, '/fixture/project')
    await service.connect('claude-desktop', 2, '/fixture/project')
    const notify = vi.fn(() => {
      throw new TypeError('Object has been destroyed')
    })
    service.subscribe(notify)
    expect(() => service.dispose()).not.toThrow()
    expect(notify).not.toHaveBeenCalled()
    expect(code.adapter.disconnect).toHaveBeenCalled()
    expect(desktop.adapter.disconnect).toHaveBeenCalled()
  })
  it('Claude Code 与 Desktop 独立连接和会话归属，共享顶层任务互斥', async () => {
    const code = fixture('claude')
    const desktop = fixture('claude-desktop')
    const service = new CodingAgentService([code.adapter, desktop.adapter])
    await service.connect('claude', 1, '/fixture/project')
    await service.connect('claude-desktop', 1, '/fixture/project')
    const a = await service.openSession('claude', 1)
    const b = await service.openSession('claude-desktop', 1)
    expect(a.id).not.toBe(b.id)
    await expect(service.send('claude-desktop', 1, a.id, '跨入口')).rejects.toThrow('会话已失效')
    await service.send('claude-desktop', 1, b.id, '合成任务')
    await expect(service.send('claude', 1, a.id, '并发任务')).rejects.toThrow('停止正在运行')
    expect(code.adapter.send).not.toHaveBeenCalled()
    await service.stop('claude-desktop', 1, b.id)
    service.disconnect('claude-desktop', 1)
    expect((await service.inspect('claude', 1)).connected).toBe(true)
  })
  it('停止请求被拒绝时保持运行状态，可再次停止，不释放顶层槽位', async () => {
    const a = fixture('opencode'),
      b = fixture('codex')
    const service = new CodingAgentService([a.adapter, b.adapter])
    const events: NativeCodingSession[] = []
    service.subscribe((_owner, event) => {
      if (event.kind === 'session') events.push(event.session)
    })
    await service.connect('opencode', 1, '/fixture/project')
    const view = await service.openSession('opencode', 1)
    await service.send('opencode', 1, view.id, '任务')
    vi.mocked(a.adapter.stop).mockImplementationOnce(() => {
      throw new Error('fixture-private')
    })
    await expect(service.stop('opencode', 1, view.id)).rejects.toThrow('fixture-private')
    expect(events.at(-1)?.status).toBe('running')
    await expect(service.connect('codex', 1, '/fixture/project')).rejects.toThrow('正在运行')
    await service.stop('opencode', 1, view.id)
    expect(events.at(-1)?.status).toBe('ready')
    service.dispose()
  })
  it('检查、连接和读取历史不创建或发送；新建和恢复只有所选运行时被调用', async () => {
    const a = fixture('opencode'),
      b = fixture('codex')
    const service = new CodingAgentService([a.adapter, b.adapter])
    await service.listRuntimes(1)
    await service.connect('opencode', 1, '/fixture/project')
    await service.listSessions('opencode', 1)
    expect(a.adapter.openSession).not.toHaveBeenCalled()
    expect(a.adapter.send).not.toHaveBeenCalled()
    const view = await service.openSession('opencode', 1)
    expect(view.nativeSessionId).toBe(a.native.id)
    expect(view.id).not.toBe(a.native.id)
    expect(a.adapter.openSession).toHaveBeenCalledWith(undefined)
    expect(b.adapter.openSession).not.toHaveBeenCalled()
    expect(b.adapter.send).not.toHaveBeenCalled()
    service.dispose()
  })

  it('跨窗口、跨运行时会话引用均拒绝；原生同名 ID 不合并', async () => {
    const a = fixture('opencode'),
      b = fixture('codex')
    const service = new CodingAgentService([a.adapter, b.adapter])
    await service.connect('opencode', 1, '/fixture/project')
    await service.connect('codex', 1, '/fixture/project')
    const av = await service.openSession('opencode', 1)
    const bv = await service.openSession('codex', 1)
    expect(av.id).not.toBe(bv.id)
    await expect(service.send('opencode', 2, av.id, 'x')).rejects.toThrow('另一个窗口')
    await expect(service.send('codex', 1, av.id, 'x')).rejects.toThrow('会话已失效')
    expect(b.adapter.send).not.toHaveBeenCalled()
    service.dispose()
  })

  it('新旧通道共用顶层运行槽位；停止后迟到运行快照不能复活任务', async () => {
    const a = fixture('opencode'),
      b = fixture('codex')
    const service = new CodingAgentService([a.adapter, b.adapter])
    await service.connect('opencode', 1, '/fixture/project')
    await service.connect('codex', 1, '/fixture/project')
    const av = await service.openSession('opencode', 1)
    const bv = await service.openSession('codex', 1)
    await service.send('codex', 1, bv.id, '任务')
    const legacy = vi.fn()
    await expect(service.runLegacy(1, IPC.opencodeSend, legacy)).rejects.toThrow('正在运行')
    expect(legacy).not.toHaveBeenCalled()
    await service.stop('codex', 1, bv.id)
    b.emit({
      ...b.native,
      status: 'running',
      messages: [{ id: 'late', role: 'assistant', content: '迟到' }]
    })
    await service.send('opencode', 1, av.id, '下一个任务')
    expect(a.adapter.send).toHaveBeenCalledTimes(1)
    service.dispose()
  })

  it('历史恢复失败不补建；断连结果未知，重连后旧引用不能发送', async () => {
    const a = fixture('opencode')
    const service = new CodingAgentService([a.adapter])
    await service.connect('opencode', 1, '/fixture/project')
    vi.mocked(a.adapter.openSession).mockRejectedValueOnce(new Error('fixture-private'))
    await expect(service.openSession('opencode', 1, 'history')).rejects.toThrow('fixture-private')
    expect(a.adapter.openSession).toHaveBeenCalledTimes(1)
    expect(a.adapter.openSession).toHaveBeenCalledWith('history')
    const view = await service.openSession('opencode', 1)
    const events: NativeCodingEvent[] = []
    service.subscribe((_owner, event) => {
      if (event.kind === 'session') events.push(event)
    })
    await service.send('opencode', 1, view.id, '任务')
    service.disconnect('opencode', 1)
    const last = events.at(-1)
    expect(last?.kind === 'session' && 'outcome' in last.session && last.session.outcome).toBe(
      'unknown'
    )
    await service.connect('opencode', 1, '/fixture/project')
    await expect(service.send('opencode', 1, view.id, '任务')).rejects.toThrow('会话已失效')
    expect(a.adapter.send).toHaveBeenCalledTimes(1)
    service.dispose()
  })
})
