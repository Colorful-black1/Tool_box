import { describe, expect, it, vi } from 'vitest'
import type { CodingAgentId } from '../../../shared/coding-agents'
import { IPC } from '../../../shared/ipc-contract'
import { CodingAgentService, unavailableRuntime } from './coding-agent-service'
import { AgentProjectMemory } from './agent-project-memory'
import type { CodingAgentAdapter, NativeCodingEvent, NativeCodingSession } from './adapter'
import { CodingAgentHistoryUnknownError } from './adapter'

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
    connect: vi.fn(async (directory: string) => {
      info.connected = true
      info.canLoadSession = true
      info.directory = directory
      native.directory = directory
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
    answerQuestion: vi.fn(),
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
  it('回退预览绑定窗口、连接、会话与运行；凭据消费一次，回读替换正文', async () => {
    const f = fixture('codex')
    f.native.canRevert = true
    f.native.messages = [{ id: 'u', role: 'user', content: '问题' }]
    f.adapter.previewRevert = vi.fn(async () => ({
      revision: 'revision',
      beforeTurnId: 'turn',
      affectedTurns: 1,
      affectedMessages: 1,
      tail: [{ role: 'user' as const, content: '问题' }],
      originalText: '问题'
    }))
    f.adapter.revert = vi.fn(async () => ({
      ...structuredClone(f.native),
      messages: [],
      historyRevision: 'fresh'
    }))
    const service = new CodingAgentService([f.adapter])
    await service.connect('codex', 1, '/fixture/project')
    const session = await service.openSession('codex', 1)
    expect(() => service.previewRevert('codex', 2, session.id, 'u')).toThrow('另一个窗口')
    const preview = await service.previewRevert('codex', 1, session.id, 'u')
    expect(preview).not.toHaveProperty('beforeTurnId')
    await expect(service.revert('codex', 1, 'other-session', preview.token)).rejects.toThrow('失效')
    const fresh = await service.revert('codex', 1, session.id, preview.token)
    expect(fresh.messages).toEqual([])
    expect(fresh.historyRevision).toBe('fresh')
    let latest = fresh
    service.subscribe((_owner, event) => {
      if (event.kind === 'session') latest = event.session
    })
    f.emit({
      ...f.native,
      contextUsage: {
        usedTokens: 99,
        windowTokens: 100,
        source: 'codex',
        approximate: false,
        measuredAt: 99,
        windowKind: 'context'
      }
    })
    expect(latest.messages).toEqual([])
    expect(latest.contextUsage).toBeUndefined()
    await expect(service.revert('codex', 1, session.id, preview.token)).rejects.toThrow('失效')
    expect(f.adapter.revert).toHaveBeenCalledOnce()
    service.dispose()
  })

  it('回退结果未知必须显示核对状态，不能被已结算事件保护吞掉', async () => {
    const f = fixture('codex')
    f.native.canRevert = true
    f.native.messages = [{ id: 'u', role: 'user', content: '问题' }]
    f.adapter.previewRevert = vi.fn(async () => ({
      revision: 'h1',
      beforeTurnId: 't',
      affectedTurns: 1,
      affectedMessages: 1,
      tail: [],
      originalText: '问题'
    }))
    f.adapter.revert = vi.fn(async () => {
      throw new CodingAgentHistoryUnknownError('请核对原生历史')
    })
    const service = new CodingAgentService([f.adapter])
    await service.connect('codex', 1, '/fixture/project')
    const session = await service.openSession('codex', 1)
    const preview = await service.previewRevert('codex', 1, session.id, 'u')
    let latest = session
    service.subscribe((_owner, event) => {
      if (event.kind === 'session') latest = event.session
    })
    await expect(service.revert('codex', 1, session.id, preview.token)).rejects.toThrow('核对')
    expect(latest).toMatchObject({
      status: 'error',
      outcome: 'unknown',
      canRevert: false,
      messages: session.messages
    })
    service.dispose()
  })

  it('新运行使旧预览失效；回退期间阻止另一 Agent 写同项目', async () => {
    const f = fixture('codex'),
      other = fixture('opencode')
    f.native.canRevert = true
    f.native.messages = [{ id: 'u', role: 'user', content: '问题' }]
    f.adapter.previewRevert = vi.fn(async () => ({
      revision: 'revision',
      beforeTurnId: 'turn',
      affectedTurns: 1,
      affectedMessages: 1,
      tail: [],
      originalText: '问题'
    }))
    let finish!: (session: NativeCodingSession) => void
    f.adapter.revert = vi.fn(
      () =>
        new Promise<NativeCodingSession>((resolve) => {
          finish = resolve
        })
    )
    const service = new CodingAgentService([f.adapter, other.adapter])
    await service.connect('codex', 1, '/fixture/project')
    await service.connect('opencode', 1, '/fixture/project')
    const session = await service.openSession('codex', 1)
    const second = await service.openSession('opencode', 1)
    const stale = await service.previewRevert('codex', 1, session.id, 'u')
    await service.send('codex', 1, session.id, '新运行')
    await service.stop('codex', 1, session.id)
    await expect(service.revert('codex', 1, session.id, stale.token)).rejects.toThrow('失效')
    const preview = await service.previewRevert('codex', 1, session.id, 'u')
    const reverting = service.revert('codex', 1, session.id, preview.token)
    await vi.waitFor(() => expect(f.adapter.revert).toHaveBeenCalledOnce())
    await expect(service.send('opencode', 1, second.id, '冲突任务')).rejects.toThrow('正在回退')
    finish({ ...f.native, messages: [] })
    await reverting
    service.dispose()
  })
  it('重新读取原生历史未返回新用量时，保留旧快照并标为失效', async () => {
    const f = fixture('codex')
    f.native.contextUsage = {
      usedTokens: 20,
      windowTokens: 100,
      source: 'codex',
      approximate: false,
      measuredAt: 1,
      windowKind: 'context'
    }
    const service = new CodingAgentService([f.adapter])
    await service.connect('codex', 1, '/fixture/project')
    const first = await service.openSession('codex', 1)
    expect(first.contextUsage?.stale).toBeUndefined()
    f.native.contextUsage = undefined
    const fresh = await service.openSession('codex', 1, f.native.id)
    expect(fresh.contextUsage).toMatchObject({ usedTokens: 20, stale: true })
    service.dispose()
  })
  it('问答只答复当前窗口、会话和运行中的原生请求，停止后不可复用', async () => {
    const f = fixture('codex')
    const service = new CodingAgentService([f.adapter])
    await service.connect('codex', 1, '/fixture/project')
    const session = await service.openSession('codex', 1)
    await service.send('codex', 1, session.id, '测试')
    f.emit({
      ...f.native,
      status: 'running',
      questions: [{ id: 'question', kind: 'questions', title: '测试问题', questions: [] }]
    })
    const answer = { requestId: 'question', cancelled: true, answers: [] }
    expect(() => service.answerQuestion('codex', 2, session.id, answer)).toThrow()
    expect(() => service.answerQuestion('codex', 1, 'foreign-session', answer)).toThrow()
    expect(() =>
      service.answerQuestion('codex', 1, session.id, { ...answer, requestId: 'old' })
    ).toThrow()
    service.answerQuestion('codex', 1, session.id, answer)
    expect(f.adapter.answerQuestion).toHaveBeenCalledExactlyOnceWith(f.native.id, answer)
    await service.stop('codex', 1, session.id)
    expect(() => service.answerQuestion('codex', 1, session.id, answer)).toThrow()
    service.dispose()
  })

  it('本地耗时在结束和断线时固定；旧上下文在新任务开始后标为失效', async () => {
    const f = fixture('codex')
    f.native.contextUsage = {
      usedTokens: 20,
      windowTokens: 100,
      source: 'codex',
      approximate: false,
      measuredAt: 1,
      windowKind: 'context'
    }
    const service = new CodingAgentService([f.adapter])
    let latest: import('../../../shared/coding-agents').CodingAgentSessionView | undefined
    service.subscribe((_owner, event) => {
      if (event.kind === 'session') latest = event.session
    })
    await service.connect('codex', 1, '/fixture/project')
    const session = await service.openSession('codex', 1)
    await service.send('codex', 1, session.id, '测试')
    expect(latest?.contextUsage?.stale).toBe(true)
    expect(latest?.timing?.finishedAt).toBeUndefined()
    f.emit({ ...f.native, status: 'ready', outcome: 'completed' })
    expect(latest?.timing?.finishedAt).toBeTypeOf('number')
    expect(latest?.timing?.elapsedMs).toBeGreaterThanOrEqual(0)
    await service.send('codex', 1, session.id, '第二轮')
    service.disconnect('codex', 1)
    expect(latest?.timing?.finishedAt).toBeTypeOf('number')
    expect(latest?.outcome).toBe('unknown')
    service.dispose()
  })
  it('保存项目选择保留实际连接，只更新记忆；运行期间不能切换项目', async () => {
    const f = fixture('opencode')
    const projects = new AgentProjectMemory({ configGet: () => ({}), configSet: () => ({}) })
    const save = vi.spyOn(projects, 'select').mockResolvedValue(process.cwd())
    vi.spyOn(projects, 'inspect').mockResolvedValue({ projectDirectory: process.cwd() })
    const service = new CodingAgentService([f.adapter], projects)
    await service.connect('opencode', 1, '/fixture/original')
    expect(save).toHaveBeenCalledWith('opencode', '/fixture/original')
    vi.mocked(f.adapter.disconnect).mockClear()
    expect(await service.selectProject('opencode', 1, process.cwd())).toBe(process.cwd())
    expect(f.adapter.disconnect).not.toHaveBeenCalled()
    const view = await service.inspect('opencode', 1)
    expect(view.directory).toBe('/fixture/original')
    expect(view.projectDirectory).toBe(process.cwd())
    expect(view.connected).toBe(true)
    const session = await service.openSession('opencode', 1)
    await service.send('opencode', 1, session.id, '任务')
    await expect(service.selectProject('opencode', 1, process.cwd())).rejects.toThrow('当前 Agent')
    expect(f.adapter.disconnect).not.toHaveBeenCalled()
    service.dispose()
  })
  it('不同项目可并行；停止、结算和断连仅释放对应运行时', async () => {
    const a = fixture('opencode')
    const b = fixture('codex')
    const service = new CodingAgentService([a.adapter, b.adapter])
    await service.connect('opencode', 1, '/fixture/project-a')
    await service.connect('codex', 1, '/fixture/project-b')
    const av = await service.openSession('opencode', 1)
    const bv = await service.openSession('codex', 1)
    await service.send('opencode', 1, av.id, '项目 A')
    await service.send('codex', 1, bv.id, '项目 B')
    expect(a.adapter.send).toHaveBeenCalledOnce()
    expect(b.adapter.send).toHaveBeenCalledOnce()
    await expect(service.send('opencode', 1, av.id, '重复')).rejects.toThrow('当前 Agent')
    await service.stop('opencode', 1, av.id)
    expect(a.adapter.stop).toHaveBeenCalledOnce()
    expect(b.adapter.stop).not.toHaveBeenCalled()
    // A 结束后收到旧的运行分片，不能释放 B 的槽位或恢复 A 的运行。
    a.emit({ ...a.native, status: 'running' })
    await expect(service.send('codex', 1, bv.id, '重复')).rejects.toThrow('当前 Agent')
    await service.send('opencode', 1, av.id, '项目 A 第二轮')
    service.disconnect('opencode', 1)
    await expect(service.connect('codex', 1, '/fixture/project-c')).rejects.toThrow('当前 Agent')
    await service.stop('codex', 1, bv.id)
    expect(b.adapter.stop).toHaveBeenCalledWith(bv.nativeSessionId)
    service.dispose()
  })

  it('原生同名会话的审批分别绑定各自运行，不允许跨运行时使用', async () => {
    const a = fixture('opencode')
    const b = fixture('codex')
    const service = new CodingAgentService([a.adapter, b.adapter])
    await service.connect('opencode', 1, '/fixture/project-a')
    await service.connect('codex', 1, '/fixture/project-b')
    const av = await service.openSession('opencode', 1)
    const bv = await service.openSession('codex', 1)
    await service.send('opencode', 1, av.id, '项目 A')
    await service.send('codex', 1, bv.id, '项目 B')
    a.emit({
      ...a.native,
      status: 'running',
      approvals: [{ id: 'approve-a', title: 'A 审批', details: '', canAllow: true }]
    })
    b.emit({
      ...b.native,
      status: 'running',
      approvals: [{ id: 'approve-b', title: 'B 审批', details: '', canAllow: true }]
    })
    service.approve('opencode', 1, av.id, 'approve-a', true)
    service.approve('codex', 1, bv.id, 'approve-b', false)
    expect(a.adapter.approve).toHaveBeenCalledWith(av.nativeSessionId, 'approve-a', true)
    expect(b.adapter.approve).toHaveBeenCalledWith(bv.nativeSessionId, 'approve-b', false)
    expect(() => service.approve('codex', 1, bv.id, 'approve-a', true)).toThrow('该审批已结束')
    service.dispose()
  })

  it('明确重读历史可更新已结束会话正文，迟到运行事件仍不能覆盖新历史', async () => {
    const f = fixture('claude-desktop')
    const service = new CodingAgentService([f.adapter])
    await service.connect('claude-desktop', 1, '/fixture/project')
    const original = await service.openSession('claude-desktop', 1, f.native.id)
    await service.send('claude-desktop', 1, original.id, '原任务')
    f.emit({ ...f.native, outcome: 'completed' })
    const messages = [{ id: 'external', role: 'assistant' as const, content: 'Desktop 新增正文' }]
    vi.mocked(f.adapter.openSession).mockResolvedValueOnce({ ...f.native, messages })
    const fresh = await service.openSession('claude-desktop', 1, f.native.id)
    expect(fresh.id).toBe(original.id)
    expect(fresh.messages).toEqual(messages)
    const events: NativeCodingEvent[] = []
    service.subscribe((_owner, event) => events.push(event))
    f.emit({ ...f.native, status: 'running', messages: [] })
    expect(events.at(-1)).toMatchObject({
      kind: 'session',
      session: { status: 'ready', messages }
    })
    service.dispose()
  })
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
  it('Claude Code 与 Desktop 独立连接和会话归属，同一项目仍互斥', async () => {
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
    await service.connect('codex', 1, '/fixture/project')
    const other = await service.openSession('codex', 1)
    await expect(service.send('codex', 1, other.id, '冲突任务')).rejects.toThrow('相同项目')
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
