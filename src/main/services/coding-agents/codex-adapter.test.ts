import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NativeCodingEvent, NativeCodingSession } from './adapter'
import { CodexAdapter, type CodexPeer } from './codex-adapter'
import { launchCodex } from './codex-runtime'
import { inspectCodexRevert } from './codex-revert-capability'

vi.mock('./codex-revert-capability', () => ({ inspectCodexRevert: vi.fn(async () => true) }))

vi.mock('./codex-runtime', () => ({
  detectCodexExecutable: vi.fn(async () => '/fixture/codex.exe'),
  inspectCodexExecutable: vi.fn(async (path: string) => ({ path, version: '0.163.0' })),
  launchCodex: vi.fn()
}))

function fixture() {
  let notify!: (method: string, params: unknown) => void
  let request!: Parameters<typeof launchCodex>[3]
  let closed!: () => void
  const directory = process.cwd()
  const thread = (id = 't1', cwd = directory) => ({
    id,
    cwd,
    name: '原生任务名称',
    preview: '',
    status: { type: 'idle' },
    turns: [],
    parentThreadId: null
  })
  const calls = vi.fn(async (method: string, _params: unknown): Promise<unknown> => {
    if (method === 'initialize') return { userAgent: 'fixture' }
    if (method === 'account/read')
      return { requiresOpenaiAuth: true, account: { type: 'chatgpt', email: 'private-account' } }
    if (method === 'model/list')
      return {
        data: [
          {
            model: 'fixture-one',
            displayName: '模型一',
            hidden: false,
            isDefault: true,
            defaultReasoningEffort: 'medium',
            supportedReasoningEfforts: [
              { reasoningEffort: 'medium' },
              { reasoningEffort: 'high' },
              { reasoningEffort: 'ultra' }
            ]
          },
          { model: 'hidden-model', hidden: true }
        ]
      }
    if (method === 'thread/list')
      return {
        data: [
          thread(),
          thread('foreign', '/other/project'),
          { ...thread('child'), parentThreadId: 't1' }
        ]
      }
    if (method === 'thread/read') return { thread: thread() }
    if (method === 'thread/start' || method === 'thread/resume')
      return {
        thread: thread(),
        model: 'fixture-one',
        reasoningEffort: 'high',
        approvalPolicy: 'on-request',
        sandbox: { type: 'readOnly' }
      }
    if (method === 'turn/start') return { turn: { id: 'r1', status: 'inProgress', items: [] } }
    return {}
  })
  const peer: CodexPeer = { request: calls, notify: vi.fn(), close: vi.fn(() => closed()) }
  vi.mocked(launchCodex).mockImplementation((_path, _dir, n, r, c) => {
    notify = n
    request = r
    closed = c
    return peer as ReturnType<typeof launchCodex>
  })
  const configSet = vi.fn()
  const service = new CodexAdapter({ configGet: () => null, configSet })
  const events: NativeCodingEvent[] = []
  service.subscribe((event) => events.push(event))
  const latest = (): NativeCodingSession => {
    const event = [...events].reverse().find((item) => item.kind === 'session')
    if (event?.kind !== 'session') throw new Error('没有会话事件')
    return event.session
  }
  return {
    service,
    peer,
    calls,
    configSet,
    events,
    latest,
    directory,
    thread,
    notify: (method: string, params: unknown) => notify(method, params),
    request: (method: string, params: unknown, id?: string | number) => request(method, params, id),
    closed: () => closed()
  }
}

beforeEach(() => vi.clearAllMocks())
afterEach(() => vi.useRealTimers())

describe('Codex 原生 App Server 适配', () => {
  it('分页标记不代表支持回退，schema 未确认时隐藏能力', async () => {
    const f = fixture()
    vi.mocked(inspectCodexRevert).mockResolvedValueOnce(false)
    const original = f.calls.getMockImplementation()!
    f.calls.mockImplementation(async (method, params) => {
      const value = await original(method, params)
      if (method === 'thread/start')
        return { ...(value as object), thread: { ...f.thread(), historyMode: 'paginated' } }
      return value
    })
    await f.service.connect(f.directory)
    expect((await f.service.openSession()).canRevert).toBe(false)
    await expect(f.service.previewRevert('t1', 'arbitrary')).rejects.toThrow('没有可确认')
    f.service.disconnect()
  })
  it('MCP 表单按原生类型答复，已解决、断线和未知 schema 安全结算', async () => {
    const f = fixture()
    await f.service.connect(f.directory)
    await f.service.openSession()
    await f.service.send('t1', '测试')
    const params = {
      threadId: 't1',
      turnId: 'r1',
      serverName: 'fixture',
      mode: 'form',
      message: '请选择',
      requestedSchema: {
        type: 'object',
        required: ['enabled'],
        properties: { enabled: { type: 'boolean' } }
      }
    }
    const pending = f.request('mcpServer/elicitation/request', params, 'mcp-one')
    const id = f.latest().questions![0].id
    f.service.answerQuestion('t1', {
      requestId: id,
      cancelled: false,
      answers: [{ questionId: 'q0', values: ['false'] }]
    })
    expect(await pending).toEqual({ action: 'accept', content: { enabled: false } })
    const resolved = f.request('mcpServer/elicitation/request', params, 'mcp-two')
    f.notify('serverRequest/resolved', { requestId: 'mcp-two' })
    expect(await resolved).toEqual({ action: 'cancel' })
    expect(
      await f.request('mcpServer/elicitation/request', {
        ...params,
        mode: 'url',
        url: 'https://example.invalid'
      })
    ).toEqual({ action: 'decline' })
    expect(
      await f.request('mcpServer/elicitation/request', { ...params, threadId: 'foreign' })
    ).toEqual({ action: 'cancel' })
    const disconnected = f.request(
      'mcpServer/elicitation/request',
      { ...params, turnId: null },
      'mcp-three'
    )
    f.closed()
    expect(await disconnected).toEqual({ action: 'cancel' })
    f.service.disconnect()
  })

  it('完整分页预览和原生回退后回读，历史变化或未知结果不盲重试', async () => {
    const f = fixture()
    const original = f.calls.getMockImplementation()!
    let turns = [1, 2].map((i) => ({
      id: `turn-${i}`,
      status: 'completed',
      items: [
        { id: `user-${i}`, type: 'userMessage', content: [{ type: 'text', text: `问题${i}` }] },
        { id: `answer-${i}`, type: 'agentMessage', text: `回答${i}` }
      ]
    }))
    let fail = false
    f.calls.mockImplementation(async (method, params) => {
      if (method === 'thread/start' || method === 'thread/resume') {
        const result = (await original(method, params)) as Record<string, unknown>
        return { ...result, thread: { ...f.thread(), historyMode: 'paginated' } }
      }
      if (method === 'thread/read') return { thread: { ...f.thread(), historyMode: 'paginated' } }
      if (method === 'thread/turns/list') {
        const cursor = (params as { cursor?: string }).cursor
        return {
          data: cursor ? turns.slice(1) : turns.slice(0, 1),
          nextCursor: !cursor && turns.length > 1 ? 'next' : null
        }
      }
      if (method === 'thread/revert') {
        if (fail) throw new Error('unknown-result')
        turns = turns.slice(
          0,
          turns.findIndex((turn) => turn.id === (params as { beforeTurnId: string }).beforeTurnId)
        )
        return { thread: { ...f.thread(), historyMode: 'paginated' } }
      }
      return original(method, params)
    })
    await f.service.connect(f.directory)
    await f.service.openSession('t1')
    const preview = await f.service.previewRevert('t1', 'user-2')
    expect(preview).toMatchObject({
      beforeTurnId: 'turn-2',
      affectedTurns: 1,
      affectedMessages: 2,
      originalText: '问题2'
    })
    const fresh = await f.service.revert('t1', preview)
    expect(fresh.messages.map((message) => message.content)).toEqual(['问题1', '回答1'])
    expect(f.calls).toHaveBeenCalledWith('thread/revert', {
      threadId: 't1',
      beforeTurnId: 'turn-2'
    })
    const stale = await f.service.previewRevert('t1', 'user-1')
    turns[0].items[1].text = '已变化'
    await expect(f.service.revert('t1', stale)).rejects.toThrow('历史已变化')
    const next = await f.service.previewRevert('t1', 'user-1')
    fail = true
    await expect(f.service.revert('t1', next)).rejects.toThrow('尚未确认')
    await expect(f.service.send('t1', '不应发送')).rejects.toThrow('结果未知')
    expect(f.latest().messages).toHaveLength(2)
    expect(f.calls.mock.calls.filter(([method]) => method === 'thread/revert')).toHaveLength(2)
    await f.service.openSession('t1')
    await f.service.previewRevert('t1', 'user-1')
    f.service.disconnect()
  })
  it('turn/start 响应前的旧用量不认领新运行，当前用量按响应 ID 消费', async () => {
    const f = fixture()
    await f.service.connect(f.directory)
    await f.service.openSession()
    f.calls.mockImplementationOnce(async () => {
      for (const [turnId, used] of [
        ['old-turn', 99],
        ['new-turn', 30]
      ] as const)
        f.notify('thread/tokenUsage/updated', {
          threadId: 't1',
          turnId,
          tokenUsage: { last: { totalTokens: used }, modelContextWindow: 100 }
        })
      expect(f.latest().contextUsage).toBeUndefined()
      return { turn: { id: 'new-turn', status: 'inProgress', items: [] } }
    })
    await f.service.send('t1', '测试')
    await vi.waitFor(() => expect(f.latest().contextUsage?.usedTokens).toBe(30))
    f.service.disconnect()
  })
  it('原生已解决和断线立即结算问题，数字与字符串请求 ID 不串用', async () => {
    const f = fixture()
    await f.service.connect(f.directory)
    await f.service.openSession()
    await f.service.send('t1', '测试')
    const input = {
      threadId: 't1',
      turnId: 'r1',
      questions: [{ id: 'q', question: '选择', options: [{ label: 'A' }] }]
    }
    f.notify('serverRequest/resolved', { requestId: 1 })
    expect(await f.request('item/tool/requestUserInput', input, 1)).toEqual({ answers: {} })
    const pending = f.request('item/tool/requestUserInput', input, '1')
    const first = f.latest().questions![0].id
    f.notify('serverRequest/resolved', { requestId: '1' })
    expect(await pending).toEqual({ answers: {} })
    expect(() =>
      f.service.answerQuestion('t1', { requestId: first, cancelled: true, answers: [] })
    ).toThrow()
    const disconnected = f.request('item/tool/requestUserInput', input, 'next')
    f.closed()
    expect(await disconnected).toEqual({ answers: {} })
    f.service.disconnect()
  })
  it('接收当前轮次用量并回答原生问题，旧轮次用量和过期回答不生效', async () => {
    const f = fixture()
    await f.service.connect(f.directory)
    await f.service.openSession()
    await f.service.send('t1', '合成任务')
    f.notify('thread/tokenUsage/updated', {
      threadId: 't1',
      turnId: 'r1',
      tokenUsage: {
        last: { totalTokens: 40 },
        total: { totalTokens: 9000 },
        modelContextWindow: 100
      }
    })
    await vi.waitFor(() => expect(f.latest().contextUsage?.usedTokens).toBe(40))
    f.notify('thread/tokenUsage/updated', {
      threadId: 't1',
      turnId: 'old',
      tokenUsage: {
        last: { totalTokens: 99 },
        modelContextWindow: 100
      }
    })
    const pending = f.request('item/tool/requestUserInput', {
      threadId: 't1',
      turnId: 'r1',
      questions: [{ id: 'native-q', question: '选择方案', options: [{ label: 'A' }] }]
    })
    const question = f.latest().questions![0]
    f.service.answerQuestion('t1', {
      requestId: question.id,
      cancelled: false,
      answers: [{ questionId: 'q0', values: ['A'] }]
    })
    expect(await pending).toEqual({ answers: { 'native-q': { answers: ['A'] } } })
    expect(f.latest().contextUsage?.usedTokens).toBe(40)
    f.service.disconnect()
  })
  it('压缩受理不结算；绑定原生压缩 turn，显示缓存满时仍等到原生完成', async () => {
    const f = fixture()
    await f.service.connect(f.directory)
    await f.service.openSession()
    await f.service.compact('t1')
    expect(f.latest().status).toBe('running')
    expect(f.calls).toHaveBeenCalledWith('thread/compact/start', { threadId: 't1' }, 30_000)
    f.notify('turn/started', { threadId: 't1', turn: { id: 'compact-turn' } })
    f.notify('item/agentMessage/delta', {
      threadId: 't1',
      turnId: 'compact-turn',
      itemId: 'summary',
      delta: 'x'.repeat(210_000)
    })
    expect(f.latest().status).toBe('running')
    f.notify('turn/completed', {
      threadId: 't1',
      turn: { id: 'compact-turn', status: 'completed', items: [] }
    })
    expect(f.latest()).toMatchObject({
      status: 'ready',
      outcome: 'completed',
      tools: [{ title: '压缩上下文', status: 'completed' }]
    })
    f.service.disconnect()
  })
  it('检测与连接只握手；模型过滤、项目历史与手动恢复保持原生身份', async () => {
    const f = fixture()
    const info = await f.service.connect(f.directory)
    expect(info.visibleModelIds).toEqual(['fixture-one'])
    expect(JSON.stringify(info)).not.toContain('private-account')
    expect(f.calls.mock.calls.map(([method]) => method)).toEqual([
      'initialize',
      'account/read',
      'model/list'
    ])
    expect(await f.service.listSessions()).toEqual([{ id: 't1', title: '原生任务名称' }])
    const view = await f.service.openSession('t1')
    expect(view.title).toBe('原生任务名称')
    expect(view.options.find((item) => item.id === 'permission')?.currentValue).toBe('read-only')
    expect(f.calls).toHaveBeenCalledWith('thread/read', { threadId: 't1', includeTurns: false })
    expect(f.calls).not.toHaveBeenCalledWith('thread/start', expect.anything())
    expect(f.configSet).toHaveBeenCalledWith({
      codex: { executablePath: '/fixture/codex.exe', directory: f.directory }
    })
    f.service.disconnect()
  })

  it('历史读取失败或项目不匹配不补建；不接管原入口的运行中会话', async () => {
    const f = fixture()
    await f.service.connect(f.directory)
    f.calls.mockImplementationOnce(async () => {
      throw new Error('fixture-private')
    })
    await expect(f.service.openSession('t1')).rejects.toThrow('fixture-private')
    f.calls.mockResolvedValueOnce({ thread: f.thread('t1', '/other/project') })
    await expect(f.service.openSession('t1')).rejects.toThrow('不属于')
    f.calls.mockResolvedValueOnce({ thread: { ...f.thread(), status: { type: 'active' } } })
    await expect(f.service.openSession('t1')).rejects.toThrow('正在执行')
    expect(f.calls.mock.calls.some(([m]) => m === 'thread/start' || m === 'thread/resume')).toBe(
      false
    )
    f.service.disconnect()
  })
  it('恢复已支持的项目写入权限，不覆盖原生配置或降回只读', async () => {
    const f = fixture()
    await f.service.connect(f.directory)
    f.calls.mockResolvedValueOnce({ thread: f.thread() })
    f.calls.mockResolvedValueOnce({
      thread: f.thread(),
      model: 'fixture-one',
      approvalPolicy: 'on-request',
      sandbox: { type: 'workspaceWrite', writableRoots: [f.directory], networkAccess: false }
    })
    const restored = await f.service.openSession('t1')
    expect(restored.options.find((item) => item.id === 'permission')?.currentValue).toBe(
      'workspace-write'
    )
    expect(f.calls).toHaveBeenCalledWith('thread/resume', { threadId: 't1', cwd: f.directory })
    expect(f.calls).not.toHaveBeenCalledWith(
      'thread/resume',
      expect.objectContaining({ sandbox: expect.anything() })
    )
    f.service.disconnect()
  })
  it('原生完全访问历史可打开，未明确选择权限前不能发送', async () => {
    const f = fixture()
    await f.service.connect(f.directory)
    f.calls.mockResolvedValueOnce({ thread: f.thread() })
    f.calls.mockResolvedValueOnce({
      thread: {
        ...f.thread(),
        turns: [
          {
            status: 'completed',
            items: [{ id: 'old-answer', type: 'agentMessage', text: '已有历史正文' }]
          }
        ]
      },
      model: 'fixture-one',
      approvalPolicy: 'never',
      sandbox: { type: 'dangerFullAccess' }
    })
    const restored = await f.service.openSession('t1')
    expect(restored.messages.some((item) => item.content === '已有历史正文')).toBe(true)
    expect(restored.options.find((item) => item.id === 'permission')?.currentValue).toBe('')
    expect(f.calls).toHaveBeenCalledWith('thread/resume', { threadId: 't1', cwd: f.directory })
    await f.service.inspect()
    expect(f.latest().options.find((item) => item.id === 'permission')?.currentValue).toBe('')
    await expect(f.service.send('t1', '继续')).rejects.toThrow('请先选择')
    expect(f.calls.mock.calls.some(([method]) => method === 'turn/start')).toBe(false)
    await f.service.setOption('t1', 'permission', 'read-only')
    await f.service.send('t1', '按所选只读权限继续')
    expect(f.calls).toHaveBeenCalledWith(
      'turn/start',
      expect.objectContaining({
        approvalPolicy: 'on-request',
        sandboxPolicy: { type: 'readOnly', networkAccess: false }
      })
    )
    f.service.disconnect()
  })
  it('新会话未确认只读权限时仍拒绝创建，不沿用完全访问', async () => {
    const f = fixture()
    await f.service.connect(f.directory)
    f.calls.mockResolvedValueOnce({
      thread: f.thread(),
      model: 'fixture-one',
      approvalPolicy: 'never',
      sandbox: { type: 'dangerFullAccess' }
    })
    await expect(f.service.openSession()).rejects.toThrow('未确认新会话的只读权限')
    expect(f.calls.mock.calls.some(([method]) => method === 'turn/start')).toBe(false)
    f.service.disconnect()
  })
  it.each([
    { type: 'workspaceWrite', writableRoots: ['/other/project'], networkAccess: false },
    { type: 'workspaceWrite', networkAccess: true },
    { type: 'unrecognizedPolicy' }
  ])('其他权限策略不阻塞浏览历史，但不能未经选择直接执行：%j', async (sandbox) => {
    const f = fixture()
    await f.service.connect(f.directory)
    f.calls.mockResolvedValueOnce({ thread: f.thread() })
    f.calls.mockResolvedValueOnce({
      thread: f.thread(),
      model: 'fixture-one',
      approvalPolicy: 'on-request',
      sandbox
    })
    const restored = await f.service.openSession('t1')
    expect(restored.id).toBe('t1')
    expect(restored.options.find((item) => item.id === 'permission')?.currentValue).toBe('')
    await expect(f.service.send('t1', '继续')).rejects.toThrow('请先选择')
    expect(f.calls.mock.calls.some(([method]) => method === 'turn/start')).toBe(false)
    f.service.disconnect()
  })

  it('增量与完成快照合并，客户端用户消息不重复，迟到旧 turn 不污染新运行', async () => {
    vi.useFakeTimers()
    const f = fixture()
    await f.service.connect(f.directory)
    await f.service.openSession()
    await f.service.setOption('t1', 'permission', 'workspace-write')
    await f.service.setOption('t1', 'effort', 'ultra')
    await f.service.send('t1', '检查代码')
    const input = f.calls.mock.calls.find(([m]) => m === 'turn/start')![1] as Record<
      string,
      unknown
    >
    expect(input.sandboxPolicy).toEqual({
      type: 'workspaceWrite',
      writableRoots: [f.directory],
      networkAccess: false
    })
    expect(input.effort).toBe('ultra')
    f.notify('item/completed', {
      threadId: 't1',
      turnId: 'r1',
      item: {
        id: 'native-user',
        type: 'userMessage',
        content: [{ type: 'text', text: '检查代码' }]
      }
    })
    f.notify('item/agentMessage/delta', {
      threadId: 't1',
      turnId: 'r1',
      itemId: 'answer',
      delta: '第一段'
    })
    await vi.advanceTimersByTimeAsync(60)
    expect(f.latest().messages.at(-1)?.content).toBe('第一段')
    f.notify('item/completed', {
      threadId: 't1',
      turnId: 'r1',
      item: { id: 'answer', type: 'agentMessage', text: '第一段，完成' }
    })
    f.notify('turn/completed', {
      threadId: 't1',
      turn: { id: 'r1', status: 'completed', items: [] }
    })
    expect(f.latest().messages).toHaveLength(2)
    expect(f.latest().messages.at(-1)?.content).toBe('第一段，完成')
    f.calls.mockImplementationOnce(async () => {
      f.notify('turn/completed', {
        threadId: 't1',
        turn: { id: 'r1', status: 'completed', items: [] }
      })
      f.notify('item/agentMessage/delta', {
        threadId: 't1',
        turnId: 'r2',
        itemId: 'next',
        delta: '第二轮'
      })
      return { turn: { id: 'r2', status: 'inProgress', items: [] } }
    })
    await f.service.send('t1', '继续')
    await vi.advanceTimersByTimeAsync(60)
    expect(f.latest().status).toBe('running')
    expect(f.latest().messages.at(-1)?.content).toBe('第二轮')
    f.service.disconnect()
  })

  it('审批绑定原运行且仅允许一次；停止只请求当前 turn，不伪造子任务终态', async () => {
    const f = fixture()
    await f.service.connect(f.directory)
    await f.service.openSession()
    await f.service.send('t1', '检查')
    const denied = await f.request('item/commandExecution/requestApproval', {
      threadId: 't1',
      turnId: 'old',
      itemId: 'cmd'
    })
    expect(denied).toEqual({ decision: 'decline' })
    const pending = f.request('item/commandExecution/requestApproval', {
      threadId: 't1',
      turnId: 'r1',
      itemId: 'cmd',
      command: 'echo test'
    })
    const approvalId = f.latest().approvals[0].id
    f.service.approve('t1', approvalId, true)
    expect(await pending).toEqual({ decision: 'accept' })
    expect(() => f.service.approve('t1', approvalId, true)).toThrow('已结束')
    f.notify('item/completed', {
      threadId: 't1',
      turnId: 'r1',
      item: {
        type: 'collabAgentToolCall',
        id: 'collab',
        senderThreadId: 't1',
        receiverThreadIds: ['child'],
        agentsStates: { child: { status: 'running' } }
      }
    })
    await f.service.stop('t1')
    expect(f.calls).toHaveBeenCalledWith('turn/interrupt', { threadId: 't1', turnId: 'r1' }, 10_000)
    f.notify('turn/completed', {
      threadId: 't1',
      turn: { id: 'r1', status: 'interrupted', items: [] }
    })
    expect(f.latest().outcome).toBe('stopped')
    expect(f.latest().subtasks?.[0].status).toBe('unknown')
    f.service.disconnect()
  })

  it('退出清理审批与计时器；重连后的旧通知不能进入新会话', async () => {
    vi.useFakeTimers()
    const f = fixture()
    await f.service.connect(f.directory)
    await f.service.openSession()
    await f.service.send('t1', '检查')
    const pending = f.request('item/fileChange/requestApproval', {
      threadId: 't1',
      turnId: 'r1',
      itemId: 'patch'
    })
    const oldNotify = vi.mocked(launchCodex).mock.calls[0][2]
    f.closed()
    expect(await pending).toEqual({ decision: 'decline' })
    expect(f.events.at(-1)).toEqual({ kind: 'connection', connected: false })
    await f.service.connect(f.directory)
    await f.service.openSession()
    oldNotify('item/agentMessage/delta', {
      threadId: 't1',
      turnId: 'r1',
      itemId: 'late',
      delta: '迟到'
    })
    await vi.advanceTimersByTimeAsync(60)
    expect(f.latest().messages).toEqual([])
    f.service.disconnect()
    expect(vi.getTimerCount()).toBe(0)
  })
})
