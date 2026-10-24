import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  CodingAgentId,
  CodingAgentRuntimeView,
  CodingAgentSessionView
} from '@shared/coding-agents'
import { useCodingAgentStore as store } from './coding-agent-store'

function info(id: CodingAgentId): CodingAgentRuntimeView {
  return {
    runtimeId: id,
    name: id,
    executablePath: `/fixture/${id}`,
    directory: '/fixture/project',
    version: 'fixture',
    connected: true,
    connectionId: `${id}-connection`,
    available: true,
    detail: '',
    canLoadSession: true,
    visibleModelIds: [],
    capabilities: {
      history: 'supported',
      resume: 'supported',
      subagents: 'unknown',
      stopSubagent: 'unsupported',
      usage: 'unknown',
      desktopHistory: 'unknown'
    }
  }
}

function session(id: CodingAgentId, ref = `${id}-ref`, revision = 1): CodingAgentSessionView {
  return {
    id: ref,
    nativeSessionId: 'same-native-id',
    runtimeId: id,
    connectionId: info(id).connectionId,
    revision,
    runId: null,
    title: '原生名称',
    directory: '/fixture/project',
    status: 'ready',
    outcome: null,
    messages: [{ id: 'answer', role: 'assistant', content: '已完成实现，验证尚未执行。' }],
    tools: [],
    options: [],
    approvals: [],
    subtasks: [],
    error: ''
  }
}

const api = {
  inspect: vi.fn(),
  connect: vi.fn(),
  createSession: vi.fn(),
  resumeSession: vi.fn(),
  send: vi.fn(),
  listSessions: vi.fn(),
  chooseDirectory: vi.fn(),
  stop: vi.fn()
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('window', { toolbox: { codingAgents: api }, confirm: vi.fn(() => true) })
  api.inspect.mockImplementation(async (id: CodingAgentId) => info(id))
  api.connect.mockImplementation(
    async ({ runtimeId, directory }: { runtimeId: CodingAgentId; directory: string }) => ({
      ...info(runtimeId),
      directory
    })
  )
  const directory = (id: CodingAgentId): string => {
    const state = store.getState()
    return (state.runtimeId === id ? state.directory : state.workspaces[id]?.directory) ?? ''
  }
  api.createSession.mockImplementation(async (id: CodingAgentId) => ({
    ...session(id),
    directory: directory(id)
  }))
  api.resumeSession.mockImplementation(async ({ runtimeId }: { runtimeId: CodingAgentId }) => ({
    ...session(runtimeId),
    directory: directory(runtimeId)
  }))
  api.send.mockResolvedValue(undefined)
  api.stop.mockResolvedValue(undefined)
  api.listSessions.mockResolvedValue([{ id: 'same-native-id', title: '原生名称' }])
  store.setState({
    runtimeId: 'opencode',
    workspaces: {},
    runningRuntime: null,
    runningSession: null,
    preparingRuntime: null,
    info: null,
    directory: '/fixture/project',
    sessions: {},
    activeId: null,
    history: [],
    historyLoaded: false,
    draft: '',
    drafts: {},
    transferred: false,
    busy: false,
    connecting: false,
    selection: 0,
    runtimeRevision: 0,
    error: ''
  })
})

afterEach(() => vi.unstubAllGlobals())

describe('工作台按需准备与明确发送', () => {
  it('切换不连接、不建会话；首次发送一次完成连接、新建和发送', async () => {
    store.getState().switchRuntime('codex')
    expect(store.getState().directory).toBe('/fixture/project')
    expect(api.connect).not.toHaveBeenCalled()
    expect(api.createSession).not.toHaveBeenCalled()
    store.getState().setDraft('检查当前项目')
    await Promise.all([store.getState().send(), store.getState().send()])
    expect(api.connect).toHaveBeenCalledExactlyOnceWith({
      runtimeId: 'codex',
      directory: '/fixture/project'
    })
    expect(api.createSession).toHaveBeenCalledExactlyOnceWith('codex')
    expect(api.send).toHaveBeenCalledExactlyOnceWith({
      runtimeId: 'codex',
      sessionId: 'codex-ref',
      content: '检查当前项目'
    })
    expect(store.getState().draft).toBe('')
  })

  it('已建会话发送失败后保留草稿，明确重试复用该会话', async () => {
    api.send.mockRejectedValueOnce(new Error('发送失败'))
    store.getState().setDraft('待发送任务')
    await store.getState().send()
    expect(store.getState().draft).toBe('待发送任务')
    expect(store.getState().activeId).toBe('opencode-ref')
    await store.getState().send()
    expect(api.createSession).toHaveBeenCalledTimes(1)
    expect(api.send).toHaveBeenCalledTimes(2)
    expect(store.getState().draft).toBe('')
  })

  it('连接失败不新建或发送；取消准备后返回的连接不会继续发任务', async () => {
    api.connect.mockRejectedValueOnce(new Error('连接失败'))
    store.getState().setDraft('保留内容')
    await store.getState().send()
    expect(api.createSession).not.toHaveBeenCalled()
    let finish!: (value: CodingAgentRuntimeView) => void
    api.connect.mockReturnValueOnce(
      new Promise<CodingAgentRuntimeView>((resolve) => {
        finish = resolve
      })
    )
    const sending = store.getState().send()
    store.getState().cancelPreparation()
    finish(info('opencode'))
    await sending
    expect(api.send).not.toHaveBeenCalled()
    expect(store.getState().draft).toBe('保留内容')
    expect(store.getState().preparingRuntime).toBeNull()
  })

  it('新建中取消不发送，已经创建的空会话仍可复用', async () => {
    await store.getState().connect()
    let finish!: (value: CodingAgentSessionView) => void
    api.createSession.mockReturnValueOnce(
      new Promise<CodingAgentSessionView>((resolve) => {
        finish = resolve
      })
    )
    store.getState().setDraft('首次任务')
    const sending = store.getState().send()
    await vi.waitFor(() => expect(api.createSession).toHaveBeenCalledTimes(1))
    store.getState().cancelPreparation()
    finish(session('opencode'))
    await sending
    expect(api.send).not.toHaveBeenCalled()
    expect(store.getState().draft).toBe('首次任务')
    await store.getState().send()
    expect(api.createSession).toHaveBeenCalledTimes(1)
    expect(api.send).toHaveBeenCalledTimes(1)
  })

  it('无可用模型停在已建会话供选择，不改模型或丢弃任务', async () => {
    api.createSession.mockResolvedValueOnce({
      ...session('opencode'),
      options: [
        { id: 'model', name: '模型', category: 'model', currentValue: 'missing', options: [] }
      ]
    })
    store.getState().setDraft('需要模型选择')
    await store.getState().send()
    expect(api.send).not.toHaveBeenCalled()
    expect(store.getState().error).toContain('模型')
    expect(store.getState().activeId).toBe('opencode-ref')
    expect(store.getState().draft).toBe('需要模型选择')
  })

  it('新对话只准备空草稿；新旧会话草稿相互保留', async () => {
    await store.getState().openSession('same-native-id')
    store.getState().setDraft('历史会话草稿')
    store.getState().newSession()
    expect(store.getState().activeId).toBeNull()
    expect(api.createSession).not.toHaveBeenCalled()
    store.getState().setDraft('新对话草稿')
    await store.getState().openSession('same-native-id')
    expect(store.getState().draft).toBe('历史会话草稿')
    expect(api.resumeSession).toHaveBeenCalledTimes(1)
    store.getState().newSession()
    expect(store.getState().draft).toBe('新对话草稿')
  })

  it('读取历史可按需连接，读取和恢复失败均不补建新会话', async () => {
    await store.getState().listSessions()
    expect(api.connect).toHaveBeenCalledTimes(1)
    expect(api.createSession).not.toHaveBeenCalled()
    expect(api.resumeSession).not.toHaveBeenCalled()
    expect(store.getState().historyLoaded).toBe(true)
    store.getState().setDraft('不要丢弃')
    api.resumeSession.mockRejectedValueOnce(new Error('恢复失败'))
    await store.getState().openSession('same-native-id')
    expect(store.getState().draft).toBe('不要丢弃')
    expect(api.createSession).not.toHaveBeenCalled()
    api.listSessions.mockRejectedValueOnce(new Error('读取失败'))
    await store.getState().listSessions()
    expect(store.getState().history).toHaveLength(1)
  })

  it('准备和发送的晚到响应只更新原工作台，发送期间编辑的新文字不被清空', async () => {
    await store.getState().openSession('same-native-id')
    store.getState().setDraft('旧输入')
    let finish!: () => void
    api.send.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finish = resolve
      })
    )
    const sending = store.getState().send()
    await vi.waitFor(() => expect(api.send).toHaveBeenCalledTimes(1))
    store.getState().setDraft('新输入')
    store.getState().switchRuntime('codex')
    store.getState().setDraft('另一 Agent 的草稿')
    finish()
    await sending
    expect(store.getState().draft).toBe('另一 Agent 的草稿')
    store.getState().switchRuntime('opencode')
    expect(store.getState().draft).toBe('新输入')
  })

  it('项目切换不带走上一项目草稿，失效连接不能隐式新建并重发', async () => {
    await store.getState().openSession('same-native-id')
    store.getState().setDraft('历史会话未发送')
    store.setState({ info: { ...info('opencode'), connected: false } })
    await store.getState().send()
    expect(api.send).not.toHaveBeenCalled()
    expect(api.createSession).not.toHaveBeenCalled()
    api.chooseDirectory.mockResolvedValueOnce('/fixture/other')
    await store.getState().chooseDirectory()
    expect(store.getState().draft).toBe('')
    expect(store.getState().activeId).toBeNull()
  })
})

describe('消息转用与来源总结', () => {
  it('目标连接其他项目时先转入正确项目草稿，发送才重连且保留旧项目草稿', async () => {
    store.getState().switchRuntime('codex')
    api.chooseDirectory.mockResolvedValueOnce('/fixture/other')
    await store.getState().chooseDirectory()
    await store.getState().openSession('same-native-id')
    store.getState().setDraft('其他项目的历史草稿')
    store.getState().switchRuntime('opencode')
    api.chooseDirectory.mockResolvedValueOnce('/fixture/project')
    await store.getState().chooseDirectory()
    await store.getState().openSession('same-native-id')
    const connected = api.connect.mock.calls.length
    store.getState().transferMessage('answer')
    expect(api.connect).toHaveBeenCalledTimes(connected)
    expect(store.getState().directory).toBe('/fixture/project')
    expect(store.getState().info?.directory).toBe('/fixture/other')
    await store.getState().send()
    expect(api.connect).toHaveBeenLastCalledWith({
      runtimeId: 'codex',
      directory: '/fixture/project'
    })
    api.chooseDirectory.mockResolvedValueOnce('/fixture/other')
    await store.getState().chooseDirectory()
    await store.getState().openSession('same-native-id')
    expect(store.getState().draft).toBe('其他项目的历史草稿')
  })
  it('目标未连接也能转用明确回复，不连接、不新建、不调用模型，保留来源草稿', async () => {
    await store.getState().openSession('same-native-id')
    store.getState().setDraft('来源未发草稿')
    api.connect.mockClear()
    store.getState().transferMessage('answer')
    expect(store.getState().runtimeId).toBe('codex')
    expect(store.getState().activeId).toBeNull()
    expect(store.getState().directory).toBe('/fixture/project')
    expect(store.getState().draft).toContain('验证尚未执行')
    expect(store.getState().draft).toContain('OpenCode')
    expect(api.connect).not.toHaveBeenCalled()
    expect(api.createSession).not.toHaveBeenCalled()
    expect(api.send).not.toHaveBeenCalled()
    store.getState().switchRuntime('opencode')
    expect(store.getState().draft).toBe('来源未发草稿')
  })

  it('目标另有项目和会话草稿时转用不覆盖，拒绝覆盖新对话草稿时保留原文', async () => {
    await store.getState().openSession('same-native-id')
    store.getState().switchRuntime('codex')
    await store.getState().openSession('same-native-id')
    store.getState().setDraft('目标历史草稿')
    store.getState().newSession()
    store.getState().setDraft('目标新草稿')
    store.getState().switchRuntime('opencode')
    vi.mocked(window.confirm).mockReturnValueOnce(false)
    store.getState().transferMessage('answer')
    expect(store.getState().runtimeId).toBe('opencode')
    store.getState().switchRuntime('codex')
    expect(store.getState().draft).toBe('目标新草稿')
    await store.getState().openSession('same-native-id')
    expect(store.getState().draft).toBe('目标历史草稿')
  })

  it('转用后可明确改用历史会话，拒绝覆盖保留两份草稿', async () => {
    store.getState().switchRuntime('codex')
    await store.getState().openSession('same-native-id')
    store.getState().setDraft('历史原稿')
    store.getState().switchRuntime('opencode')
    await store.getState().openSession('same-native-id')
    store.getState().transferMessage('answer')
    const transferred = store.getState().draft
    vi.mocked(window.confirm).mockReturnValueOnce(false)
    await store.getState().openSession('same-native-id', true)
    expect(store.getState().draft).toBe(transferred)
    expect(store.getState().activeId).toBeNull()
    await store.getState().openSession('same-native-id', true)
    expect(store.getState().activeId).toBe('codex-ref')
    expect(store.getState().draft).toBe(transferred)
    expect(api.send).not.toHaveBeenCalled()
  })

  it('转用正在流式生成或超长回复时不发送、不截断', async () => {
    await store.getState().openSession('same-native-id')
    store.getState().receive({
      kind: 'session',
      session: { ...session('opencode', 'opencode-ref', 2), status: 'running' }
    })
    store.getState().transferMessage('answer')
    expect(store.getState().runtimeId).toBe('opencode')
    store.getState().receive({
      kind: 'session',
      session: {
        ...session('opencode', 'opencode-ref', 3),
        messages: [{ id: 'answer', role: 'assistant', content: 'x'.repeat(50_000) }]
      }
    })
    store.getState().transferMessage('answer')
    expect(store.getState().error).toContain('超过')
    expect(api.send).not.toHaveBeenCalled()
  })

  it('生成说明只请求来源会话，原草稿保留，已有运行时不排队', async () => {
    await store.getState().openSession('same-native-id')
    store.getState().setDraft('正在编辑的下一步')
    await store.getState().summarize()
    expect(api.send).toHaveBeenCalledExactlyOnceWith({
      runtimeId: 'opencode',
      sessionId: 'opencode-ref',
      content: expect.stringContaining('交接说明')
    })
    expect(store.getState().draft).toBe('正在编辑的下一步')
    store.setState({ runningRuntime: 'opencode', runningSession: 'opencode-ref' })
    await store.getState().summarize()
    expect(api.send).toHaveBeenCalledTimes(1)
  })
})

describe('原生事件和运行身份', () => {
  it('发送确认尚未返回时，停止仍立即命中当前运行', async () => {
    await store.getState().openSession('same-native-id')
    let finish!: () => void
    api.send.mockImplementationOnce(() => {
      store.getState().receive({
        kind: 'session',
        session: {
          ...session('opencode', 'opencode-ref', 2),
          status: 'running'
        }
      })
      return new Promise<void>((resolve) => {
        finish = resolve
      })
    })
    store.getState().setDraft('执行中的任务')
    const sending = store.getState().send()
    await vi.waitFor(() => expect(store.getState().runningRuntime).toBe('opencode'))
    await store.getState().stop()
    expect(api.stop).toHaveBeenCalledExactlyOnceWith({
      runtimeId: 'opencode',
      sessionId: 'opencode-ref'
    })
    finish()
    await sending
  })
  it('断开后直接点原生会话会恢复；仅重连不能把旧草稿隐式发到新会话', async () => {
    await store.getState().openSession('same-native-id')
    store.getState().setDraft('旧会话草稿')
    store.setState({ info: { ...info('opencode'), connected: false } })
    await store.getState().listSessions()
    await store.getState().send()
    expect(api.createSession).not.toHaveBeenCalled()
    expect(api.send).not.toHaveBeenCalled()
    await store.getState().openSession('same-native-id')
    expect(api.resumeSession).toHaveBeenCalledTimes(2)
    expect(store.getState().draft).toBe('旧会话草稿')
  })
  it('晚到程序检测只更新原 Agent，不覆盖当前选择', async () => {
    let finish!: (value: CodingAgentRuntimeView) => void
    api.inspect.mockReturnValueOnce(
      new Promise<CodingAgentRuntimeView>((resolve) => {
        finish = resolve
      })
    )
    const checking = store.getState().inspect()
    store.getState().switchRuntime('codex')
    await store.getState().connect()
    finish(info('opencode'))
    await checking
    expect(store.getState().runtimeId).toBe('codex')
    expect(store.getState().info?.runtimeId).toBe('codex')
  })
  it('旧连接与过期事件不改变后台运行；查看和停止命中实际任务', async () => {
    await store.getState().openSession('same-native-id')
    store.getState().receive({
      kind: 'session',
      session: { ...session('opencode', 'opencode-ref', 3), status: 'running' }
    })
    store.getState().newSession()
    store.getState().switchRuntime('codex')
    store.getState().receive({
      kind: 'session',
      session: { ...session('opencode', 'opencode-ref', 2), status: 'ready' }
    })
    store.getState().receive({
      kind: 'session',
      session: { ...session('opencode', 'opencode-ref', 4), connectionId: 'old', status: 'ready' }
    })
    expect(store.getState().runningRuntime).toBe('opencode')
    await store.getState().stop()
    expect(api.stop).toHaveBeenCalledExactlyOnceWith({
      runtimeId: 'opencode',
      sessionId: 'opencode-ref'
    })
    store.getState().viewRunning()
    expect(store.getState().runtimeId).toBe('opencode')
    expect(store.getState().activeId).toBe('opencode-ref')
    store.getState().receive({
      kind: 'session',
      session: { ...session('opencode', 'opencode-ref', 5), status: 'ready' }
    })
    expect(store.getState().runningRuntime).toBeNull()
  })
})
