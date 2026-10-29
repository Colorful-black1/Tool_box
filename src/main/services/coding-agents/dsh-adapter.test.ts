import { afterEach, describe, expect, it, vi } from 'vitest'
import { DshAdapter, type DshPeer } from './dsh-adapter'
import {
  attachDshWorkspace,
  dshSessionMessages,
  dshSessionMetadata,
  launchDsh
} from './dsh-runtime'
import type { NativeCodingEvent } from './adapter'

vi.mock('./dsh-runtime', () => ({
  attachDshWorkspace: vi.fn(async () => ({ workspace: 'fixture', message: 'ok' })),
  detectDshExecutable: vi.fn(async () => '/fixture/dsh.exe'),
  dshLaunchDirectory: vi.fn(() => '/fixture/launch'),
  dshSessionMessages: vi.fn(async () => []),
  dshSessionMetadata: vi.fn(async () => new Map()),
  inspectDshExecutable: vi.fn(async () => ({
    path: '/fixture/dsh.exe',
    command: '/fixture/dsh.exe',
    args: [],
    electronNode: false,
    version: '0.2.1-rc.3'
  })),
  launchDsh: vi.fn()
}))
const adapters: DshAdapter[] = []
afterEach(() => {
  for (const adapter of adapters.splice(0)) adapter.disconnect()
  vi.useRealTimers()
})

async function fixture() {
  let notification!: (method: string, value: unknown) => void
  let permission!: (method: string, value: unknown) => Promise<unknown>
  let disconnected!: () => void
  let finish!: (value: unknown) => void
  const options = [
    {
      id: 'model',
      name: '模型',
      category: 'model',
      type: 'select',
      currentValue: 'fixture-model',
      options: [{ value: 'fixture-model', name: '原生模型' }]
    }
  ]
  const calls = vi.fn(async (method: string): Promise<unknown> => {
    if (method === 'initialize')
      return {
        protocolVersion: 1,
        agentCapabilities: { sessionCapabilities: { list: {}, resume: {}, close: {} } }
      }
    if (method === 'session/new') return { sessionId: 'new-native', configOptions: options }
    if (method === 'session/resume' || method === 'session/set_config_option')
      return { configOptions: options }
    if (method === 'session/list')
      return {
        sessions: [
          { sessionId: 'history-native', cwd: process.cwd(), title: '原生历史' },
          { sessionId: 'foreign', cwd: '/other', title: '其他项目' }
        ]
      }
    if (method === 'session/prompt')
      return new Promise((resolve) => {
        finish = resolve
      })
    return {}
  })
  const peer: DshPeer = { request: calls, notify: vi.fn(), close: vi.fn() }
  vi.mocked(launchDsh).mockImplementation((_spec, _cwd, notify, request, closed) => {
    notification = notify
    permission = request
    disconnected = closed
    return peer as ReturnType<typeof launchDsh>
  })
  const adapter = new DshAdapter({ configGet: () => ({}), configSet: () => ({}) })
  adapters.push(adapter)
  const events: NativeCodingEvent[] = []
  adapter.subscribe((event) => events.push(event))
  const info = await adapter.connect(process.cwd())
  return {
    adapter,
    calls,
    peer,
    events,
    info,
    notification: (value: unknown) => notification('session/update', value),
    permission: (value: unknown) => permission('session/request_permission', value),
    disconnected: () => disconnected(),
    finish: (value: unknown) => finish(value)
  }
}

describe('DSH ACP 适配器', () => {
  it('宿主使用独立启动目录，项目路径只通过会话 cwd 传入', async () => {
    vi.mocked(launchDsh).mockClear()
    await fixture()
    expect(vi.mocked(launchDsh).mock.calls.at(-1)?.[1]).toBe('/fixture/launch')
  })
  it('历史列表使用 Desktop 缓存标题，并隐藏空白会话', async () => {
    const f = await fixture()
    vi.mocked(dshSessionMetadata).mockResolvedValueOnce(
      new Map([
        ['history-native', { title: '桌面历史标题', blank: false, lastPromptAt: 10 }],
        ['blank-native', { title: '', blank: true, lastPromptAt: null }],
        ['empty-native', { title: '', blank: false, lastPromptAt: null }]
      ])
    )
    f.calls.mockImplementationOnce(async (method: string) => {
      if (method === 'session/list')
        return {
          sessions: [
            { sessionId: 'history-native', cwd: process.cwd() },
            { sessionId: 'blank-native', cwd: process.cwd() },
            { sessionId: 'empty-native', cwd: process.cwd() }
          ]
        }
      return {}
    })
    await expect(f.adapter.listSessions()).resolves.toEqual([
      { id: 'history-native', title: '桌面历史标题' }
    ])
  })
  it('恢复历史时读取会话正文', async () => {
    const f = await fixture()
    vi.mocked(dshSessionMessages).mockResolvedValueOnce([
      { id: 'u1', role: 'user', content: '历史问题' },
      { id: 'a1', role: 'assistant', content: '历史回答' }
    ])
    const session = await f.adapter.openSession('history-native')
    expect(session.messages).toEqual([
      { id: 'u1', role: 'user', content: '历史问题' },
      { id: 'a1', role: 'assistant', content: '历史回答' }
    ])
  })
  it('恢复失败时仍返回历史正文并标记断开', async () => {
    const f = await fixture()
    vi.mocked(dshSessionMessages).mockResolvedValueOnce([
      { id: 'u1', role: 'user', content: '历史问题' }
    ])
    f.calls.mockImplementation(async (method: string) => {
      if (method === 'session/list')
        return { sessions: [{ sessionId: 'history-native', cwd: process.cwd() }] }
      if (method === 'session/resume') throw new Error('session busy')
      return {}
    })
    const session = await f.adapter.openSession('history-native')
    expect(session.status).toBe('disconnected')
    expect(session.messages).toEqual([{ id: 'u1', role: 'user', content: '历史问题' }])
    expect(session.error).toContain('历史正文已加载')
  })
  it('工作区归组委托给 DSH 写入，不创建会话', async () => {
    const f = await fixture()
    vi.mocked(attachDshWorkspace).mockResolvedValueOnce({
      workspace: 'study_tool',
      message: '已归入'
    })
    await expect(f.adapter.attachWorkspace('history-native', process.cwd())).resolves.toEqual({
      workspace: 'study_tool',
      message: '已归入'
    })
    expect(attachDshWorkspace).toHaveBeenCalledWith('history-native', process.cwd())
  })
  it('迟到的旧初始化失败不关闭新连接', async () => {
    const peers: DshPeer[] = []
    let failOld!: (error: Error) => void
    const launch = vi.fn(() => {
      const first = peers.length === 0
      const peer: DshPeer = {
        request: vi.fn(async (method: string) => {
          if (method !== 'initialize') return {}
          if (first)
            return new Promise((_resolve, reject) => {
              failOld = reject
            })
          return {
            protocolVersion: 1,
            agentCapabilities: { sessionCapabilities: { list: {}, resume: {}, close: {} } }
          }
        }),
        notify: vi.fn(),
        close: vi.fn()
      }
      peers.push(peer)
      return peer
    })
    const adapter = new DshAdapter({ configGet: () => ({}), configSet: () => ({}) }, launch)
    adapters.push(adapter)
    const old = adapter.connect(process.cwd()).catch((error: unknown) => error)
    await vi.waitFor(() => expect(peers).toHaveLength(1))
    adapter.disconnect()
    await adapter.connect(process.cwd())
    failOld(new Error('fixture old process failed'))
    expect(await old).toBeInstanceOf(Error)
    expect((await adapter.inspect()).connected).toBe(true)
    expect(peers[1].close).not.toHaveBeenCalled()
  })
  it('连接不建会话或发送；按项目列举和续接，不伪造历史正文', async () => {
    const f = await fixture()
    expect(f.calls.mock.calls.map(([method]) => method)).toEqual(['initialize'])
    expect(f.info.capabilities).toMatchObject({
      history: 'unsupported',
      resume: 'supported',
      subagents: 'unsupported'
    })
    expect(f.info.detail).toContain('DSH 原生规则')
    expect(await f.adapter.listSessions()).toEqual([{ id: 'history-native', title: '原生历史' }])
    await expect(f.adapter.openSession('foreign')).rejects.toThrow('不属于当前项目')
    const session = await f.adapter.openSession('history-native')
    expect(session.messages).toEqual([])
    expect(f.calls.mock.calls.some(([method]) => method === 'session/load')).toBe(false)
    expect(f.events.at(-1)).toMatchObject({
      kind: 'runtime',
      runtime: { visibleModelIds: ['fixture-model'] }
    })
  })
  it('只接受自己会话的提交更新；停止等待原生结算，迟到事件不能恢复运行', async () => {
    const f = await fixture()
    const session = await f.adapter.openSession()
    f.adapter.send(session.id, '合成请求')
    f.notification({
      sessionId: 'foreign',
      update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '不应出现' } }
    })
    f.notification({
      sessionId: session.id,
      update: {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: '提交后的整段回复' }
      }
    })
    expect(f.events.at(-1)).toMatchObject({
      kind: 'session',
      session: { messages: [{ content: '合成请求' }, { content: '提交后的整段回复' }] }
    })
    f.adapter.stop(session.id)
    expect(f.peer.notify).toHaveBeenCalledWith('session/cancel', { sessionId: session.id })
    expect(f.events.at(-1)).toMatchObject({ kind: 'session', session: { status: 'stopping' } })
    f.finish({ stopReason: 'cancelled' })
    await vi.waitFor(() =>
      expect(f.events.at(-1)).toMatchObject({
        kind: 'session',
        session: { status: 'ready', outcome: 'stopped' }
      })
    )
    const count = f.events.length
    f.notification({
      sessionId: session.id,
      update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '迟到' } }
    })
    expect(f.events).toHaveLength(count)
  })
  it('审批只有单次选项，无永久授权；拒绝、停止、断连都能结束等待', async () => {
    const f = await fixture()
    const session = await f.adapter.openSession()
    f.adapter.send(session.id, '合成请求')
    const ask = () =>
      f.permission({
        sessionId: session.id,
        toolCall: { title: '工具', rawInput: { api_key: 'fixture-private' } },
        options: [
          { kind: 'allow_always', optionId: 'always' },
          { kind: 'allow_once', optionId: 'once' },
          { kind: 'reject_once', optionId: 'reject' }
        ]
      })
    const approvalId = () => {
      const event = f.events.at(-1)
      if (event?.kind !== 'session') throw new Error('缺少审批')
      expect(event.session.approvals[0].details).not.toContain('fixture-private')
      return event.session.approvals[0].id
    }
    const allow = ask()
    f.adapter.approve(session.id, approvalId(), true)
    expect(await allow).toEqual({ outcome: { outcome: 'selected', optionId: 'once' } })
    const deny = ask()
    f.adapter.approve(session.id, approvalId(), false)
    expect(await deny).toEqual({ outcome: { outcome: 'selected', optionId: 'reject' } })
    const stopped = ask()
    f.adapter.stop(session.id)
    expect(await stopped).toEqual({ outcome: { outcome: 'selected', optionId: 'reject' } })
    f.disconnected()
    expect(f.events.at(-1)).toEqual({ kind: 'connection', connected: false })
    expect(await ask()).toEqual({ outcome: { outcome: 'cancelled' } })
  })
  it('停止超时只断开自有连接，关闭请求只针对自己打开的会话', async () => {
    const f = await fixture()
    const session = await f.adapter.openSession()
    vi.useFakeTimers()
    f.adapter.send(session.id, '合成请求')
    f.adapter.stop(session.id)
    await vi.advanceTimersByTimeAsync(5000)
    expect(f.peer.request).toHaveBeenCalledWith('session/close', { sessionId: session.id }, 4000)
    expect(f.peer.close).toHaveBeenCalled()
    expect((await f.adapter.inspect()).connected).toBe(false)
  })
})
