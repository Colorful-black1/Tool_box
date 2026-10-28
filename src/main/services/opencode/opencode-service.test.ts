import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OpenCodeEvent } from '../../../shared/types'
import { OpenCodeService } from './opencode-service'
import type { AcpPeer } from './opencode-service'
import { detectOpenCodeExecutable, launchOpenCode } from './opencode-runtime'
import { readOpenCodeVisibleModels } from './opencode-models'

vi.mock('./opencode-models', () => ({
  readOpenCodeVisibleModels: vi.fn(async () => ['fixture/model-one'])
}))

vi.mock('./opencode-runtime', () => ({
  inspectOpenCodeExecutable: vi.fn(async (path: string) => ({ path, version: '2.1.1' })),
  detectOpenCodeExecutable: vi.fn(async () => '/fixture/opencode-cli.exe'),
  launchOpenCode: vi.fn()
}))

const choices = [
  {
    id: 'mode',
    name: 'Mode',
    category: 'mode',
    type: 'select',
    currentValue: 'build',
    options: [
      { value: 'build', name: 'Build' },
      { value: 'plan', name: 'Plan' }
    ]
  },
  {
    id: 'model',
    name: 'Model',
    category: 'model',
    type: 'select',
    currentValue: 'fixture/model-one',
    options: [
      { value: 'fixture/model-one', name: '模型一' },
      { value: 'fixture/model-two', name: '模型二' }
    ]
  }
]

function setup() {
  let counter = 0
  let history: unknown[] = []
  const store = { configGet: vi.fn(() => ({})), configSet: vi.fn(() => ({})) }
  const events: OpenCodeEvent[] = []
  const requests: Array<{ method: string; params: unknown }> = []
  let finish: ((value: unknown) => void) | undefined
  let fail: ((error: Error) => void) | undefined
  let notification: Parameters<typeof launchOpenCode>[2] = () => undefined
  let permission: Parameters<typeof launchOpenCode>[3] = async () => null
  let disconnected: Parameters<typeof launchOpenCode>[4] = () => undefined
  const peer: AcpPeer = {
    request: vi.fn(async (method, params) => {
      requests.push({ method, params })
      if (method === 'initialize')
        return {
          protocolVersion: 1,
          agentInfo: { name: 'OpenCode' },
          agentCapabilities: { loadSession: true }
        }
      if (method === 'session/new')
        return { sessionId: `s${++counter}`, configOptions: structuredClone(choices) }
      if (method === 'session/load') return { configOptions: structuredClone(choices) }
      if (method === 'session/list') return { sessions: history }
      if (method === 'session/prompt')
        return new Promise((resolve, reject) => {
          finish = resolve
          fail = reject
        })
      return {}
    }),
    notify: vi.fn(),
    close: vi.fn()
  }
  const launch = vi.fn(
    (
      ...[_executable, _directory, onNotification, onRequest, onDisconnect]: Parameters<
        typeof launchOpenCode
      >
    ) => {
      notification = onNotification
      permission = onRequest
      disconnected = onDisconnect
      return peer
    }
  )
  const service = new OpenCodeService(store, launch)
  service.subscribe((event) => events.push(structuredClone(event)))
  return {
    service,
    store,
    events,
    requests,
    peer,
    setHistory: (sessions: unknown[]) => {
      history = sessions
    },
    notify: (params: unknown) => notification('session/update', params),
    permission: (method: string, params: unknown) => permission(method, params),
    disconnect: () => disconnected(),
    finish: () => finish?.({ stopReason: 'end_turn' }),
    fail: () => fail?.(new Error('fixture-private-detail'))
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(readOpenCodeVisibleModels).mockResolvedValue(['fixture/model-one'])
  vi.spyOn(console, 'info').mockImplementation(() => undefined)
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('OpenCode 会话业务', () => {
  it('提前缓存建会话响应前的命令；显示已满仍可压缩，不把摘要塞进显示缓存', async () => {
    const f = setup()
    await f.service.connect(process.cwd())
    f.notify({
      sessionId: 's1',
      update: {
        sessionUpdate: 'available_commands_update',
        availableCommands: [{ name: 'compact', description: '压缩' }]
      }
    })
    const session = await f.service.openSession()
    expect(f.service.commands(session.id).map((item) => item.name)).toEqual(['compact'])
    session.messages = Array.from({ length: 200 }, (_, index) => ({
      id: `old-${index}`,
      role: 'assistant',
      content: '历史'
    }))
    f.service.send(session.id, '/compact', { command: true })
    f.notify({
      sessionId: session.id,
      update: {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'x'.repeat(210_000) }
      }
    })
    expect(session.status).toBe('running')
    expect(session.messages.length).toBe(200)
    f.finish()
    await vi.waitFor(() =>
      expect(session.tools[0]).toMatchObject({ title: '压缩上下文', status: 'completed' })
    )
    f.service.disconnect()
  })
  it('恢复不同原生会话时保留各自名称，重新读取历史同步已经打开的会话', async () => {
    const { service, setHistory } = setup()
    await service.connect(process.cwd())
    const rows = [
      { sessionId: 'saved-a', cwd: process.cwd(), title: '分析 Java 异常' },
      { sessionId: 'saved-b', cwd: process.cwd(), title: '整理项目结构' }
    ]
    setHistory(rows)
    await service.listSessions()
    const a = await service.openSession('saved-a')
    const b = await service.openSession('saved-b')
    expect(a.title).toBe('分析 Java 异常')
    expect(b.title).toBe('整理项目结构')
    setHistory([{ ...rows[0], title: '原生界面修改的名称' }, rows[1]])
    await service.listSessions()
    expect(a.title).toBe('原生界面修改的名称')
    expect(b.title).toBe('整理项目结构')
    service.disconnect()
  })

  it('任务完成后读取标题并延迟补读一次，不持续轮询且断连会取消补读', async () => {
    vi.useFakeTimers()
    const { service, setHistory, requests, finish } = setup()
    await service.connect(process.cwd())
    const session = await service.openSession()
    service.send(session.id, '合成任务')
    const row = { sessionId: session.id, cwd: process.cwd(), title: '任务完成时的原生名称' }
    setHistory([row])
    finish()
    await vi.advanceTimersByTimeAsync(0)
    expect(session.title).toBe(row.title)
    setHistory([{ ...row, title: '稍后生成的原生名称' }])
    await vi.advanceTimersByTimeAsync(10_000)
    expect(session.title).toBe('稍后生成的原生名称')
    const reads = () => requests.filter((item) => item.method === 'session/list').length
    const afterRefresh = reads()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(reads()).toBe(afterRefresh)
    service.send(session.id, '另一条合成任务')
    finish()
    await vi.advanceTimersByTimeAsync(0)
    const beforeDisconnect = reads()
    service.disconnect()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(reads()).toBe(beforeDisconnect)
  })

  it('标题读取失败保留历史名称，不阻止恢复会话', async () => {
    const { service, setHistory } = setup()
    await service.connect(process.cwd())
    setHistory([{ sessionId: 'saved', cwd: process.cwd(), title: '已知原生名称' }])
    await service.listSessions()
    vi.spyOn(service, 'listSessions').mockRejectedValueOnce(new Error('fixture-private-detail'))
    const session = await service.openSession('saved')
    expect(session.title).toBe('已知原生名称')
    expect(session.status).toBe('ready')
    expect(session.error).toBe('')
    service.disconnect()
  })

  it('过期历史响应不能覆盖较新的推送标题，也不能在断连后回写', async () => {
    const { service, peer, notify } = setup()
    await service.connect(process.cwd())
    const session = await service.openSession()
    let resolveList: ((value: unknown) => void) | undefined
    const deferList = () =>
      new Promise<unknown>((resolve) => {
        resolveList = resolve
      })
    vi.mocked(peer.request).mockImplementationOnce(deferList)
    const reading = service.listSessions()
    notify({
      sessionId: session.id,
      update: { sessionUpdate: 'session_info_update', title: '最新名称' }
    })
    const snapshot = {
      sessions: [{ sessionId: session.id, cwd: process.cwd(), title: '旧快照名称' }]
    }
    resolveList?.(snapshot)
    expect((await reading)[0].title).toBe('最新名称')
    expect(session.title).toBe('最新名称')
    vi.mocked(peer.request).mockImplementationOnce(deferList)
    const stale = service.listSessions()
    const rejected = expect(stale).rejects.toThrow('连接已结束')
    service.disconnect()
    resolveList?.(snapshot)
    await rejected
    expect(session.title).toBe('最新名称')
  })

  it('只允许 Desktop 可见模型，同步隐藏当前模型后停止后续发送', async () => {
    const { service } = setup()
    const info = await service.connect(process.cwd())
    expect(info.visibleModelIds).toEqual(['fixture/model-one'])
    const session = await service.openSession()
    await expect(service.setOption(session.id, 'model', 'fixture/model-two')).rejects.toThrow(
      'Desktop'
    )
    vi.mocked(readOpenCodeVisibleModels).mockResolvedValueOnce(['fixture/model-two'])
    expect((await service.inspect()).visibleModelIds).toEqual(['fixture/model-two'])
    expect(() => service.send(session.id, '合成任务')).toThrow('未在 Desktop 启用')
    await service.setOption(session.id, 'model', 'fixture/model-two')
    service.disconnect()
  })
  it('读取模型偏好失败时明确失败，不返回完整目录或创建会话', async () => {
    const { service, requests } = setup()
    vi.mocked(readOpenCodeVisibleModels).mockRejectedValueOnce(new Error('fixture'))
    await expect(service.connect(process.cwd())).rejects.toThrow()
    expect((await service.inspect()).connected).toBe(false)
    expect(requests.map((request) => request.method)).toEqual(['initialize'])
  })
  it('不兼容的握手不会留下可发送任务的连接', async () => {
    const { service, peer } = setup()
    vi.mocked(peer.request).mockResolvedValueOnce({
      protocolVersion: 2,
      agentInfo: { name: 'OpenCode' }
    })
    await expect(service.connect(process.cwd())).rejects.toThrow('协议')
    expect((await service.inspect()).connected).toBe(false)
    expect(peer.close).toHaveBeenCalled()
  })
  it('缺少 Plan 模式时不以 Build 模式静默继续', async () => {
    const { service, peer } = setup()
    await service.connect(process.cwd())
    vi.mocked(peer.request).mockResolvedValueOnce({ sessionId: 'bad', configOptions: [] })
    await expect(service.openSession()).rejects.toThrow('Plan')
    expect(() => service.send('bad', '合成任务')).toThrow('已失效')
    service.disconnect()
  })
  it('原生会话列表只返回当前工作目录的摘要', async () => {
    const { service, peer } = setup()
    await service.connect(process.cwd())
    vi.mocked(peer.request).mockResolvedValueOnce({
      sessions: [
        { sessionId: 'own', cwd: process.cwd(), title: '当前项目' },
        { sessionId: 'other', cwd: '/fixture/other', title: '其他项目' },
        { sessionId: 'missing-directory', title: '缺少目录' }
      ]
    })
    expect(await service.listSessions()).toEqual([{ id: 'own', title: '当前项目' }])
    service.disconnect()
  })
  it('主动停止后收到取消错误仍结算为就绪，普通错误不泄漏内部细节', async () => {
    const { service, fail } = setup()
    await service.connect(process.cwd())
    const session = await service.openSession()
    service.send(session.id, '合成请求')
    service.stop(session.id)
    fail()
    await vi.waitFor(() => expect(session.status).toBe('ready'))
    expect(session.error).toBe('')
    service.send(session.id, '另一个合成请求')
    fail()
    await vi.waitFor(() => expect(session.status).toBe('error'))
    expect(session.error).not.toContain('private')
    service.disconnect()
  })
  it('检测之后 Desktop 更新，连接会重新定位而不继续使用旧路径', async () => {
    const { service, requests } = setup()
    vi.mocked(detectOpenCodeExecutable)
      .mockResolvedValueOnce('/fixture/old/opencode-cli.exe')
      .mockResolvedValueOnce('/fixture/current/opencode-cli.exe')
    expect((await service.inspect()).executablePath).toContain('/old/')
    expect((await service.connect(process.cwd())).executablePath).toContain('/current/')
    expect(requests.map((item) => item.method)).toEqual(['initialize'])
    service.disconnect()
  })
  it('检测只返回程序信息，连接保留其他配置且不自动请求模型', async () => {
    const { service, store, requests } = setup()
    expect((await service.inspect()).executablePath).toContain('opencode-cli')
    const info = await service.connect(process.cwd())
    expect(info.connected).toBe(true)
    expect(store.configSet).toHaveBeenCalledWith({
      opencode: { executablePath: '/fixture/opencode-cli.exe', directory: info.directory }
    })
    expect(requests.map((item) => item.method)).toEqual(['initialize'])
    service.disconnect()
  })
  it('新会话优先 Plan，配置只能选择运行时提供的值', async () => {
    const { service, requests } = setup()
    await service.connect(process.cwd())
    const session = await service.openSession()
    expect(session.options[0].currentValue).toBe('plan')
    expect(requests).toContainEqual({
      method: 'session/set_config_option',
      params: { sessionId: 's1', configId: 'mode', value: 'plan' }
    })
    await expect(service.setOption(session.id, 'mode', 'invented')).rejects.toThrow('提供的配置项')
    service.disconnect()
  })
  it('恢复历史保留原生模式，不静默切换成 Plan', async () => {
    const { service, requests } = setup()
    await service.connect(process.cwd())
    const restored = await service.openSession('saved-build-session')
    expect(restored.options[0].currentValue).toBe('build')
    expect(requests.some((item) => item.method === 'session/set_config_option')).toBe(false)
    service.disconnect()
  })
  it('发送只运行当前会话，拒绝并发与未知会话', async () => {
    const { service, notify, finish } = setup()
    await service.connect(process.cwd())
    const a = await service.openSession()
    const b = await service.openSession()
    service.send(a.id, '合成请求')
    expect(() => service.send(b.id, '另一个请求')).toThrow('一次运行一个')
    expect(() => service.send('unknown', '请求')).toThrow('已失效')
    notify({
      sessionId: 'unknown',
      update: {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: '不能进入其他会话' }
      }
    })
    notify({
      sessionId: a.id,
      update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '合成回答' } }
    })
    expect(a.messages.at(-1)?.content).toBe('合成回答')
    expect(b.messages).toEqual([])
    finish()
    await vi.waitFor(() => expect(a.status).toBe('ready'))
    service.disconnect()
  })
  it('审批只能单次允许，不能跨会话批准；停止自动拒绝待审批', async () => {
    const { service, permission, peer, finish } = setup()
    await service.connect(process.cwd())
    const a = await service.openSession()
    const b = await service.openSession()
    service.send(a.id, '合成请求')
    const outcome = permission('session/request_permission', {
      sessionId: a.id,
      toolCall: { title: '写入合成文件', rawInput: { password: 'fixture-value' } },
      options: [
        { kind: 'allow_once', optionId: 'one' },
        { kind: 'allow_always', optionId: 'forever' },
        { kind: 'reject_once', optionId: 'no' }
      ]
    })
    const approval = a.approvals[0]
    expect(approval.details).not.toContain('fixture-value')
    expect(() => service.approve(b.id, approval.id, true)).toThrow('不属于')
    service.stop(a.id)
    await expect(outcome).resolves.toEqual({ outcome: { outcome: 'selected', optionId: 'no' } })
    expect(peer.notify).toHaveBeenCalledWith('session/cancel', { sessionId: a.id })
    expect(a.approvals).toEqual([])
    finish()
    await vi.waitFor(() => expect(a.status).toBe('ready'))
    service.disconnect()
  })
  it('缺少单次允许选项时不扩大为永久允许', async () => {
    const { service, permission, finish } = setup()
    await service.connect(process.cwd())
    const a = await service.openSession()
    service.send(a.id, '合成请求')
    const outcome = permission('session/request_permission', {
      sessionId: a.id,
      options: [{ kind: 'allow_always', optionId: 'forever' }]
    })
    expect(a.approvals[0].canAllow).toBe(false)
    service.approve(a.id, a.approvals[0].id, true)
    await expect(outcome).resolves.toEqual({ outcome: { outcome: 'cancelled' } })
    finish()
    service.disconnect()
  })
  it('未宣称的客户端文件与终端能力不执行', async () => {
    const { service, permission } = setup()
    await service.connect(process.cwd())
    await expect(permission('fs/write_text_file', { path: '/fixture' })).rejects.toThrow('不支持')
    service.disconnect()
  })
  it('断连后旧通知和任务结算不能恢复运行状态', async () => {
    const { service, notify, finish, events } = setup()
    await service.connect(process.cwd())
    const session = await service.openSession()
    service.send(session.id, '合成请求')
    service.disconnect()
    notify({
      sessionId: session.id,
      update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '迟到消息' } }
    })
    finish()
    await Promise.resolve()
    await Promise.resolve()
    expect(session.status).toBe('disconnected')
    expect(session.messages.some((item) => item.content.includes('迟到'))).toBe(false)
    expect(events.at(-1)).toEqual({ kind: 'connection', connected: false })
  })
  it('不接受相对目录，失败不留下可用连接', async () => {
    const { service } = setup()
    await expect(service.connect('relative/path')).rejects.toThrow('绝对项目目录')
    expect((await service.inspect()).connected).toBe(false)
  })
})
