import { confirmDialog } from './dialog-store'
vi.mock('./dialog-store', () => ({ confirmDialog: vi.fn(async () => true) }))
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
  selectProject: vi.fn(async ({ directory }: { directory: string }) => directory),
  stop: vi.fn(),
  approve: vi.fn()
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
    runs: {},
    preparations: {},
    info: null,
    directory: '/fixture/project',
    inheritedProject: false,
    projectMemory: undefined,
    handoff: null,
    sessions: {},
    closedSessions: [],
    activeId: null,
    history: [],
    historyLoaded: false,
    draft: '',
    drafts: {},
    transferred: false,
    recall: null,
    recallSequence: 0,
    busy: false,
    connecting: false,
    selection: 0,
    runtimeRevision: 0,
    error: ''
  })
})

afterEach(() => vi.unstubAllGlobals())

describe('工作台按需准备与明确发送', () => {
  it('关闭当前标签切换相邻会话并保存两份草稿，重新打开只激活缓存', async () => {
    const first = { ...session('opencode', 'first', 3), nativeSessionId: 'native-first' }
    const second = { ...session('opencode', 'second', 3), nativeSessionId: 'native-second' }
    store.setState({ info: info('opencode'), sessions: { first, second }, activeId: 'first' })
    store.getState().setDraft('第一份草稿')
    await store.getState().selectSession('second')
    store.getState().setDraft('第二份草稿')
    expect(store.getState().closeSession('second')).toBe(true)
    expect(store.getState().activeId).toBe('first')
    expect(store.getState().draft).toBe('第一份草稿')
    expect(store.getState().sessions.second).toEqual(second)
    expect(store.getState().closedSessions).toEqual(['second'])
    await store.getState().openSession('native-second')
    expect(store.getState().closedSessions).toEqual([])
    expect(store.getState().draft).toBe('第二份草稿')
    expect(api.resumeSession).not.toHaveBeenCalled()
    expect(api.send).not.toHaveBeenCalled()
    expect(api.stop).not.toHaveBeenCalled()
  })

  it('关闭非当前标签不动选中项，迟到更新不重开，最后一页关闭后仍可恢复草稿', async () => {
    const first = { ...session('opencode', 'first', 3), nativeSessionId: 'native-first' }
    const second = { ...session('opencode', 'second', 3), nativeSessionId: 'native-second' }
    store.setState({ info: info('opencode'), sessions: { first, second }, activeId: 'first' })
    store.getState().setDraft('保留第一份草稿')
    const selection = store.getState().selection
    expect(store.getState().closeSession('second')).toBe(true)
    expect(store.getState().selection).toBe(selection)
    expect(store.getState().draft).toBe('保留第一份草稿')
    store
      .getState()
      .receive({ kind: 'session', session: { ...second, revision: 4, title: '晚到名称' } })
    expect(store.getState().closedSessions).toContain('second')
    expect(store.getState().closeSession('first')).toBe(true)
    expect(store.getState().activeId).toBeNull()
    expect(store.getState().closedSessions).toEqual(['second', 'first'])
    await store.getState().openSession('native-first')
    expect(store.getState().draft).toBe('保留第一份草稿')
  })

  it('执行、停止和准备中的会话不关闭，其他 Agent 的标签状态独立', async () => {
    const first = session('opencode', 'first', 3)
    store.setState({ info: info('opencode'), sessions: { first }, activeId: 'first' })
    store
      .getState()
      .receive({ kind: 'session', session: { ...first, revision: 4, status: 'running' } })
    expect(store.getState().closeSession('first')).toBe(false)
    store
      .getState()
      .receive({ kind: 'session', session: { ...first, revision: 5, status: 'stopping' } })
    expect(store.getState().closeSession('first')).toBe(false)
    store
      .getState()
      .receive({ kind: 'session', session: { ...first, revision: 6, status: 'ready' } })
    store.setState({ preparations: { opencode: true } })
    expect(store.getState().closeSession('first')).toBe(false)
    store.setState({ preparations: {} })
    expect(store.getState().closeSession('first')).toBe(true)
    store.getState().switchRuntime('codex')
    expect(store.getState().closedSessions).toEqual([])
    store.getState().switchRuntime('opencode')
    expect(store.getState().closedSessions).toEqual(['first'])
    expect(api.stop).not.toHaveBeenCalled()
  })

  it('核对未知结果只恢复原生会话，失败不创建替代会话也不重发', async () => {
    await store.getState().openSession('same-native-id')
    store
      .getState()
      .receive({
        kind: 'session',
        session: { ...session('opencode', 'opencode-ref', 3), status: 'error', outcome: 'unknown' }
      })
    store.getState().setDraft('用户的下一步草稿')
    api.resumeSession.mockClear()
    api.resumeSession.mockRejectedValueOnce(new Error('原生历史暂不可读'))
    await store.getState().refreshSession()
    expect(store.getState().error).toContain('原生历史暂不可读')
    expect(store.getState().draft).toBe('用户的下一步草稿')
    expect(api.resumeSession).toHaveBeenCalledExactlyOnceWith({
      runtimeId: 'opencode',
      sessionId: 'same-native-id'
    })
    expect(api.createSession).not.toHaveBeenCalled()
    expect(api.send).not.toHaveBeenCalled()
  })
  it('取回用户消息只改草稿，取消恢复原稿且不连接或发送', async () => {
    await store.getState().openSession('same-native-id')
    store.getState().receive({
      kind: 'session',
      session: {
        ...session('opencode', 'opencode-ref', 3),
        messages: [{ id: 'user-1', role: 'user', content: '原问题' }]
      }
    })
    store.getState().setDraft('下一步草稿')
    api.connect.mockClear()
    await store.getState().recallMessage('user-1')
    expect(store.getState().draft).toBe('原问题')
    expect(store.getState().sessions['opencode-ref'].messages[0].content).toBe('原问题')
    await store.getState().cancelRecall()
    expect(store.getState().draft).toBe('下一步草稿')
    expect(api.connect).not.toHaveBeenCalled()
    expect(api.send).not.toHaveBeenCalled()
  })

  it('取消覆盖或确认期间改输入，不覆盖新草稿', async () => {
    await store.getState().openSession('same-native-id')
    store.getState().receive({
      kind: 'session',
      session: {
        ...session('opencode', 'opencode-ref', 3),
        messages: [{ id: 'user-1', role: 'user', content: '原问题' }]
      }
    })
    store.getState().setDraft('原稿')
    vi.mocked(confirmDialog).mockResolvedValueOnce(false)
    await store.getState().recallMessage('user-1')
    expect(store.getState().draft).toBe('原稿')
    vi.mocked(confirmDialog).mockImplementationOnce(async () => {
      store.getState().setDraft('新输入')
      return true
    })
    await store.getState().recallMessage('user-1')
    expect(store.getState().draft).toBe('新输入')
    expect(store.getState().recall).toBeNull()
  })
  it('未打开过的目标先只读检查记忆，取消不创建或修改目标工作台', async () => {
    await store.getState().openSession('same-native-id')
    api.inspect.mockResolvedValueOnce({
      ...info('codex'),
      connected: false,
      projectDirectory: '/fixture/last-codex'
    })
    vi.mocked(confirmDialog).mockResolvedValueOnce(false)
    const connects = api.connect.mock.calls.length
    await store.getState().transferMessage('answer', 'codex')
    expect(confirmDialog).toHaveBeenLastCalledWith(expect.stringContaining('/fixture/last-codex'))
    expect(store.getState().workspaces.codex).toBeUndefined()
    expect(store.getState().runtimeId).toBe('opencode')
    expect(api.connect).toHaveBeenCalledTimes(connects)
    expect(api.selectProject).not.toHaveBeenCalled()
  })

  it('未打开过的目标确认后保留来源项目，不被迟到的记忆检测改回去', async () => {
    await store.getState().openSession('same-native-id')
    const remembered = {
      ...info('codex'),
      connected: false,
      projectDirectory: '/fixture/last-codex'
    }
    api.inspect.mockResolvedValue(remembered)
    const connects = api.connect.mock.calls.length
    await store.getState().transferMessage('answer', 'codex')
    expect(store.getState().handoff?.previousDirectory).toBe('/fixture/last-codex')
    expect(store.getState().directory).toBe('/fixture/project')
    const transferred = store.getState().draft
    await store.getState().inspect(true)
    expect(store.getState().directory).toBe('/fixture/project')
    expect(store.getState().draft).toBe(transferred)
    expect(api.connect).toHaveBeenCalledTimes(connects)
    expect(api.send).not.toHaveBeenCalled()
  })

  it('未打开过的目标记忆与来源相同，不额外确认或显示提示', async () => {
    await store.getState().openSession('same-native-id')
    api.inspect.mockResolvedValueOnce({
      ...info('codex'),
      connected: false,
      projectDirectory: '/fixture/project'
    })
    await store.getState().transferMessage('answer', 'codex')
    expect(confirmDialog).not.toHaveBeenCalled()
    expect(store.getState().directory).toBe('/fixture/project')
    expect(store.getState().handoff).toBeNull()
  })

  it('记忆路径格式损坏时不把其他 Agent 的继承项目当作自己的项目', async () => {
    store.getState().switchRuntime('codex')
    api.inspect.mockResolvedValueOnce({
      ...info('codex'),
      connected: false,
      projectDirectory: '',
      projectError: '上次保存的项目路径无效，请重新选择项目'
    })
    await store.getState().inspect()
    expect(store.getState().directory).toBe('')
    expect(store.getState().error).toContain('重新选择')
    expect(api.connect).not.toHaveBeenCalled()
  })

  it('只读检测未完成时目标选择变化，旧检测不得覆盖新项目', async () => {
    await store.getState().openSession('same-native-id')
    let finish!: (value: CodingAgentRuntimeView) => void
    api.inspect.mockReturnValueOnce(
      new Promise<CodingAgentRuntimeView>((resolve) => {
        finish = resolve
      })
    )
    const pending = store.getState().transferMessage('answer', 'codex')
    store.getState().switchRuntime('codex')
    api.chooseDirectory.mockResolvedValueOnce('/fixture/new-choice')
    await store.getState().chooseDirectory()
    store.getState().setDraft('新项目输入')
    finish({ ...info('codex'), projectDirectory: '/fixture/old-choice' })
    await pending
    expect(store.getState().directory).toBe('/fixture/new-choice')
    expect(store.getState().draft).toBe('新项目输入')
    expect(confirmDialog).not.toHaveBeenCalled()
    expect(api.send).not.toHaveBeenCalled()
  })

  it('跨项目取消后目标项目、连接、会话和草稿完整不变', async () => {
    await store.getState().openSession('same-native-id')
    store.getState().switchRuntime('codex')
    api.chooseDirectory.mockResolvedValueOnce('/fixture/target')
    await store.getState().chooseDirectory()
    await store.getState().openSession('same-native-id')
    await store.getState().listSessions()
    store.getState().setDraft('目标历史草稿')
    store.getState().switchRuntime('opencode')
    const target = structuredClone(store.getState().workspaces.codex)
    const connects = api.connect.mock.calls.length
    vi.mocked(confirmDialog).mockResolvedValueOnce(false)
    await store.getState().transferMessage('answer', 'codex')
    expect(confirmDialog).toHaveBeenLastCalledWith(
      expect.stringContaining('原有连接将在发送时断开')
    )
    expect(store.getState().workspaces.codex).toEqual(target)
    expect(store.getState().runtimeId).toBe('opencode')
    expect(api.connect).toHaveBeenCalledTimes(connects)
    expect(api.send).not.toHaveBeenCalled()
    expect(api.selectProject).not.toHaveBeenCalled()
  })

  it('确认转用只改项目草稿，返回恢复原项目草稿且不操作原生连接', async () => {
    await store.getState().openSession('same-native-id')
    store.getState().switchRuntime('codex')
    api.chooseDirectory.mockResolvedValueOnce('/fixture/target')
    await store.getState().chooseDirectory()
    await store.getState().connect()
    store.getState().setDraft('目标项目的新对话草稿')
    const connection = store.getState().info
    store.getState().switchRuntime('opencode')
    const connects = api.connect.mock.calls.length
    const resumes = api.resumeSession.mock.calls.length
    await store.getState().transferMessage('answer', 'codex')
    const transferred = store.getState().draft
    expect(store.getState().directory).toBe('/fixture/project')
    expect(store.getState().info).toEqual(connection)
    expect(store.getState().handoff).toMatchObject({
      sourceId: 'opencode',
      previousDirectory: '/fixture/target',
      connectionReplaced: false
    })
    expect(api.connect).toHaveBeenCalledTimes(connects)
    expect(api.send).not.toHaveBeenCalled()
    await store.getState().returnProject()
    expect(api.selectProject).toHaveBeenCalledExactlyOnceWith({
      runtimeId: 'codex',
      directory: '/fixture/target'
    })
    expect(store.getState().directory).toBe('/fixture/target')
    expect(store.getState().activeId).toBeNull()
    expect(store.getState().draft).toBe('目标项目的新对话草稿')
    expect(store.getState().drafts['["/fixture/project",null]']).toBe(transferred)
    expect(store.getState().handoff).toBeNull()
    expect(api.connect).toHaveBeenCalledTimes(connects)
    expect(api.resumeSession).toHaveBeenCalledTimes(resumes)
    expect(api.send).not.toHaveBeenCalled()
  })

  it('跨项目等待确认时目标重连，旧确认不能覆盖新连接和草稿', async () => {
    await store.getState().openSession('same-native-id')
    store.getState().switchRuntime('codex')
    api.chooseDirectory.mockResolvedValueOnce('/fixture/target')
    await store.getState().chooseDirectory()
    await store.getState().connect()
    store.getState().setDraft('原目标草稿')
    store.getState().switchRuntime('opencode')
    let approve!: (value: boolean) => void
    vi.mocked(confirmDialog).mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          approve = resolve
        })
    )
    const transfer = store.getState().transferMessage('answer', 'codex')
    const target = store.getState().workspaces.codex!
    store.setState({
      workspaces: {
        ...store.getState().workspaces,
        codex: { ...target, info: { ...target.info!, connectionId: 'new-target-connection' } }
      }
    })
    approve(true)
    await transfer
    expect(store.getState().runtimeId).toBe('opencode')
    expect(store.getState().workspaces.codex?.directory).toBe('/fixture/target')
    expect(store.getState().workspaces.codex?.draft).toBe('原目标草稿')
    expect(store.getState().error).toContain('已变化')
  })

  it('原连接实际断开后才更新转用提示，历史会话草稿不混入交接文字', async () => {
    await store.getState().openSession('same-native-id')
    store.getState().switchRuntime('codex')
    api.chooseDirectory.mockResolvedValueOnce('/fixture/target')
    await store.getState().chooseDirectory()
    await store.getState().openSession('same-native-id')
    store.getState().setDraft('原历史草稿')
    store.getState().switchRuntime('opencode')
    await store.getState().transferMessage('answer', 'codex')
    expect(store.getState().handoff?.connectionReplaced).toBe(false)
    expect(store.getState().drafts['["/fixture/target","same-native-id"]']).toBe('原历史草稿')
    store.getState().receive({
      kind: 'runtime',
      runtime: { ...info('codex'), directory: '/fixture/target', connected: false },
      revision: 99
    })
    expect(store.getState().handoff?.connectionReplaced).toBe(true)
    await store.getState().returnProject()
    expect(store.getState().activeId).toBeNull()
    expect(store.getState().drafts['["/fixture/target","same-native-id"]']).toBe('原历史草稿')
  })

  it('项目记忆优先于旧草稿 selection，恢复不会连接、读取历史或发任务', async () => {
    api.inspect.mockResolvedValueOnce({
      ...info('opencode'),
      connected: false,
      projectDirectory: '/fixture/remembered'
    })
    await store.getState().inspect()
    store.getState().restoreDrafts(
      {
        version: 1,
        selection: { runtimeId: 'opencode', directory: '/fixture/old-selection' },
        drafts: []
      },
      new Set(),
      false
    )
    expect(store.getState().directory).toBe('/fixture/remembered')
    expect(api.connect).not.toHaveBeenCalled()
    expect(api.listSessions).not.toHaveBeenCalled()
    expect(api.createSession).not.toHaveBeenCalled()
    expect(api.send).not.toHaveBeenCalled()
  })

  it('不可访问的记忆目录提示重新选择，明确选择后立即更新自己的记忆', async () => {
    api.inspect.mockResolvedValueOnce({
      ...info('opencode'),
      connected: false,
      projectDirectory: '/fixture/missing',
      projectError: '上次选择的项目不存在或不可访问，请重新选择项目'
    })
    await store.getState().inspect()
    expect(store.getState().directory).toBe('/fixture/missing')
    expect(store.getState().error).toContain('重新选择')
    api.chooseDirectory.mockResolvedValueOnce('/fixture/new-project')
    await store.getState().chooseDirectory()
    expect(api.chooseDirectory).toHaveBeenCalledExactlyOnceWith('opencode')
    expect(store.getState().projectMemory).toBe('/fixture/new-project')
    expect(store.getState().error).toBe('')
    expect(api.connect).not.toHaveBeenCalled()
  })

  it('切换恢复各自项目、历史和草稿，不用来源项目重置目标工作台', async () => {
    await store.getState().openSession('same-native-id')
    store.getState().setDraft('项目 A 草稿')
    store.getState().switchRuntime('codex')
    api.chooseDirectory.mockResolvedValueOnce('/fixture/project-b')
    await store.getState().chooseDirectory()
    await store.getState().openSession('same-native-id')
    await store.getState().listSessions()
    store.getState().setDraft('项目 B 草稿')
    store.getState().switchRuntime('opencode')
    expect(store.getState().directory).toBe('/fixture/project')
    expect(store.getState().activeId).toBe('opencode-ref')
    expect(store.getState().draft).toBe('项目 A 草稿')
    store.getState().switchRuntime('codex')
    expect(store.getState().directory).toBe('/fixture/project-b')
    expect(store.getState().activeId).toBe('codex-ref')
    expect(store.getState().historyLoaded).toBe(true)
    expect(store.getState().draft).toBe('项目 B 草稿')
  })

  it('首次继承项目仅作起点，检测优先恢复该 Agent 的原生项目偏好', async () => {
    store.getState().switchRuntime('codex')
    api.inspect.mockResolvedValueOnce({ ...info('codex'), directory: '/fixture/saved-project' })
    await store.getState().inspect()
    expect(store.getState().directory).toBe('/fixture/saved-project')
    store.getState().switchRuntime('opencode')
    store.getState().switchRuntime('codex')
    expect(store.getState().directory).toBe('/fixture/saved-project')
    api.chooseDirectory.mockResolvedValueOnce('/fixture/explicit-project')
    await store.getState().chooseDirectory()
    await store.getState().inspect(true)
    expect(store.getState().directory).toBe('/fixture/explicit-project')
  })
  it('用户明确选择继承来的同一目录后，检测不再覆盖该选择', async () => {
    store.getState().switchRuntime('codex')
    api.chooseDirectory.mockResolvedValueOnce('/fixture/project')
    await store.getState().chooseDirectory()
    api.inspect.mockResolvedValueOnce({ ...info('codex'), directory: '/fixture/saved-project' })
    await store.getState().inspect()
    expect(store.getState().directory).toBe('/fixture/project')
  })

  it('两个项目独立发送，A 结算或断连不会解锁、停止或覆盖 B', async () => {
    await store.getState().openSession('same-native-id')
    store.getState().setDraft('项目 A 任务')
    store.getState().switchRuntime('codex')
    api.chooseDirectory.mockResolvedValueOnce('/fixture/project-b')
    await store.getState().chooseDirectory()
    await store.getState().openSession('same-native-id')
    store.getState().setDraft('项目 B 任务')
    api.send.mockImplementation(async ({ runtimeId }: { runtimeId: CodingAgentId }) => {
      const state = store.getState()
      const current = state.runtimeId === runtimeId ? state : state.workspaces[runtimeId]!
      store.getState().receive({
        kind: 'session',
        session: {
          ...session(runtimeId, `${runtimeId}-ref`, 2),
          directory: current.directory,
          status: 'running'
        }
      })
    })
    store.getState().switchRuntime('opencode')
    await store.getState().send()
    store.getState().switchRuntime('codex')
    await store.getState().send()
    expect(api.send).toHaveBeenCalledTimes(2)
    expect(Object.keys(store.getState().runs)).toEqual(['opencode', 'codex'])
    store.getState().receive({
      kind: 'session',
      session: { ...session('opencode', 'opencode-ref', 3), outcome: 'completed' }
    })
    expect(store.getState().runs.opencode).toBeUndefined()
    expect(store.getState().runs.codex?.directory).toBe('/fixture/project-b')
    store.getState().receive({
      kind: 'runtime',
      runtime: { ...info('opencode'), connected: false },
      revision: 100
    })
    await store.getState().stop()
    expect(api.stop).toHaveBeenCalledExactlyOnceWith({ runtimeId: 'codex', sessionId: 'codex-ref' })
    expect(store.getState().directory).toBe('/fixture/project-b')
    store.getState().viewRunning('opencode')
    expect(store.getState().runtimeId).toBe('codex')
  })

  it('旧运行迟到的结算不会清除同会话的新运行', () => {
    store.setState({
      info: info('opencode'),
      runs: {
        opencode: { sessionId: 'opencode-ref', runId: 'run-new', directory: '/fixture/project' }
      }
    })
    store.getState().receive({
      kind: 'session',
      session: { ...session('opencode', 'opencode-ref', 4), runId: 'run-old', outcome: 'completed' }
    })
    expect(store.getState().runs.opencode?.runId).toBe('run-new')
    store.getState().receive({
      kind: 'session',
      session: { ...session('opencode', 'opencode-ref', 5), runId: 'run-new', outcome: 'completed' }
    })
    expect(store.getState().runs.opencode).toBeUndefined()
  })

  it('不同 Agent 可同时准备，取消 A 不取消 B，也不把 A 的草稿误发送', async () => {
    const completions = new Map<CodingAgentId, () => void>()
    api.connect.mockImplementation(
      ({ runtimeId, directory }: { runtimeId: CodingAgentId; directory: string }) =>
        new Promise<CodingAgentRuntimeView>((resolve) => {
          completions.set(runtimeId, () => resolve({ ...info(runtimeId), directory }))
        })
    )
    store.getState().setDraft('项目 A 待发送')
    const a = store.getState().send()
    store.getState().switchRuntime('codex')
    api.chooseDirectory.mockResolvedValueOnce('/fixture/project-b')
    await store.getState().chooseDirectory()
    store.getState().setDraft('项目 B 待发送')
    const b = store.getState().send()
    await vi.waitFor(() =>
      expect(store.getState().preparations).toEqual({ opencode: true, codex: true })
    )
    store.getState().cancelPreparation('opencode')
    completions.get('codex')!()
    await b
    completions.get('opencode')!()
    await a
    expect(api.createSession).toHaveBeenCalledExactlyOnceWith('codex')
    expect(api.send).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ runtimeId: 'codex' })
    )
    expect(store.getState().preparations).toEqual({})
    store.getState().switchRuntime('opencode')
    expect(store.getState().draft).toBe('项目 A 待发送')
    expect(store.getState().error).toContain('已取消')
  })

  it('Claude 刷新列表及再次点选会话会重读正文，不重连、不丢草稿', async () => {
    store.getState().switchRuntime('claude-desktop')
    await store.getState().openSession('same-native-id')
    store.getState().setDraft('保留未发送草稿')
    const updated = session('claude-desktop', 'claude-desktop-ref', 2)
    updated.messages = [{ id: 'external', role: 'assistant', content: '外部新增正文' }]
    api.resumeSession.mockResolvedValueOnce(updated)
    await store.getState().listSessions()
    expect(store.getState().sessions[updated.id].messages).toEqual(updated.messages)
    expect(store.getState().draft).toBe('保留未发送草稿')
    api.resumeSession.mockResolvedValueOnce({ ...updated, revision: 3 })
    await store.getState().openSession('same-native-id')
    expect(api.resumeSession).toHaveBeenCalledTimes(3)
    expect(api.connect).toHaveBeenCalledTimes(1)
    expect(api.createSession).not.toHaveBeenCalled()
    expect(api.send).not.toHaveBeenCalled()
  })
  it('Claude 正文重读失败仍保留旧正文与输入，不补建新会话', async () => {
    store.getState().switchRuntime('claude-desktop')
    await store.getState().openSession('same-native-id')
    const before = store.getState().sessions['claude-desktop-ref']
    store.getState().setDraft('重读失败也保留')
    api.resumeSession.mockRejectedValueOnce(new Error('原生历史暂不可读'))
    await store.getState().listSessions()
    expect(store.getState().sessions['claude-desktop-ref']).toEqual(before)
    expect(store.getState().draft).toBe('重读失败也保留')
    expect(store.getState().error).toContain('原生历史暂不可读')
    expect(api.createSession).not.toHaveBeenCalled()
  })
  it('Code 与 Desktop 分别保留草稿，Desktop 首次发送只连接自己的入口', async () => {
    store.getState().switchRuntime('claude')
    store.getState().setDraft('Code 待发送')
    store.getState().switchRuntime('claude-desktop')
    expect(store.getState().draft).toBe('')
    store.getState().setDraft('Desktop 待发送')
    const document = store.getState().draftDocument()
    expect(document.drafts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ runtimeId: 'claude', content: 'Code 待发送' }),
        expect.objectContaining({ runtimeId: 'claude-desktop', content: 'Desktop 待发送' })
      ])
    )
    await store.getState().send()
    expect(api.connect).toHaveBeenCalledExactlyOnceWith({
      runtimeId: 'claude-desktop',
      directory: '/fixture/project'
    })
    expect(api.createSession).toHaveBeenCalledExactlyOnceWith('claude-desktop')
    expect(api.send).toHaveBeenCalledExactlyOnceWith({
      runtimeId: 'claude-desktop',
      sessionId: 'claude-desktop-ref',
      content: 'Desktop 待发送'
    })
    store.getState().switchRuntime('claude')
    expect(store.getState().draft).toBe('Code 待发送')
  })
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
    expect(store.getState().preparations).toEqual({})
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

  it('断开重连后重新读取历史仍能恢复列表', async () => {
    await store.getState().listSessions()
    expect(store.getState().history).toHaveLength(1)
    store.setState({ info: { ...info('opencode'), connected: false } })
    api.connect.mockResolvedValueOnce({
      ...info('opencode'),
      connectionId: 'opencode-connection-2'
    })
    await store.getState().listSessions()
    expect(store.getState().info?.connectionId).toBe('opencode-connection-2')
    expect(store.getState().history).toHaveLength(1)
    expect(store.getState().historyLoaded).toBe(true)
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
    await store.getState().transferMessage('answer')
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
    await store.getState().transferMessage('answer')
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
    vi.mocked(confirmDialog).mockResolvedValueOnce(false)
    await store.getState().transferMessage('answer')
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
    await store.getState().transferMessage('answer')
    const transferred = store.getState().draft
    vi.mocked(confirmDialog).mockResolvedValueOnce(false)
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
    await store.getState().transferMessage('answer')
    expect(store.getState().runtimeId).toBe('opencode')
    store.getState().receive({
      kind: 'session',
      session: {
        ...session('opencode', 'opencode-ref', 3),
        messages: [{ id: 'answer', role: 'assistant', content: 'x'.repeat(50_000) }]
      }
    })
    await store.getState().transferMessage('answer')
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
    store.setState({
      runs: { opencode: { sessionId: 'opencode-ref', runId: null, directory: '/fixture/project' } }
    })
    await store.getState().summarize()
    expect(api.send).toHaveBeenCalledTimes(1)
  })
})

describe('原生事件和运行身份', () => {
  it('发送确认未返回时仍可审批，切换后不会批准另一 Agent 的任务', async () => {
    await store.getState().openSession('same-native-id')
    let finish!: () => void
    api.send.mockImplementationOnce(() => {
      store.getState().receive({
        kind: 'session',
        session: {
          ...session('opencode', 'opencode-ref', 2),
          status: 'running',
          approvals: [{ id: 'approval-a', title: '审批 A', details: '', canAllow: true }]
        }
      })
      return new Promise<void>((resolve) => {
        finish = resolve
      })
    })
    store.getState().setDraft('等待审批的任务')
    const sending = store.getState().send()
    await vi.waitFor(() => expect(store.getState().busy).toBe(true))
    await vi.waitFor(() => expect(store.getState().runs.opencode).toBeDefined())
    await store.getState().approve('approval-a', true)
    expect(api.approve).toHaveBeenCalledExactlyOnceWith({
      runtimeId: 'opencode',
      sessionId: 'opencode-ref',
      approvalId: 'approval-a',
      approved: true
    })
    store.getState().switchRuntime('codex')
    await store.getState().stop()
    expect(api.stop).not.toHaveBeenCalled()
    finish()
    await sending
  })
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
    await vi.waitFor(() => expect(store.getState().runs.opencode?.sessionId).toBe('opencode-ref'))
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
    expect(store.getState().runs.opencode?.sessionId).toBe('opencode-ref')
    await store.getState().stop('opencode')
    expect(api.stop).toHaveBeenCalledExactlyOnceWith({
      runtimeId: 'opencode',
      sessionId: 'opencode-ref'
    })
    store.getState().viewRunning('opencode')
    expect(store.getState().runtimeId).toBe('opencode')
    expect(store.getState().activeId).toBe('opencode-ref')
    store.getState().receive({
      kind: 'session',
      session: { ...session('opencode', 'opencode-ref', 5), status: 'ready' }
    })
    expect(store.getState().runs.opencode).toBeUndefined()
  })
  it('等待转用确认期间目标草稿变化，不覆盖新内容', async () => {
    await store.getState().openSession('same-native-id')
    store.getState().switchRuntime('codex')
    store.getState().setDraft('目标原稿')
    store.getState().switchRuntime('opencode')
    let answer!: (value: boolean) => void
    vi.mocked(confirmDialog).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          answer = resolve
        })
    )
    const pending = store.getState().transferMessage('answer')
    await vi.waitFor(() => expect(answer).toBeTypeOf('function'))
    store.getState().switchRuntime('codex')
    store.getState().setDraft('等待期间的新输入')
    answer(true)
    await pending
    expect(store.getState().draft).toBe('等待期间的新输入')
    expect(api.send).not.toHaveBeenCalled()
  })
  it('等待转用确认期间的目标会话事件不会被旧快照覆盖', async () => {
    await store.getState().openSession('same-native-id')
    store.getState().switchRuntime('codex')
    await store.getState().openSession('same-native-id')
    store.getState().newSession()
    store.getState().setDraft('目标原稿')
    store.getState().switchRuntime('opencode')
    let answer!: (value: boolean) => void
    vi.mocked(confirmDialog).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          answer = resolve
        })
    )
    const pending = store.getState().transferMessage('answer')
    const updated = { ...session('codex', 'codex-ref', 8), title: '等待期间更新的标题' }
    store.getState().receive({ kind: 'session', session: updated })
    answer(true)
    await pending
    expect(store.getState().runtimeId).toBe('codex')
    expect(store.getState().sessions['codex-ref'].title).toBe('等待期间更新的标题')
    expect(store.getState().sessions['codex-ref'].revision).toBe(8)
  })
  it('等待会话覆盖确认期间输入变化，保持当前会话和两份草稿', async () => {
    await store.getState().openSession('same-native-id')
    store.getState().setDraft('历史草稿')
    store.getState().newSession()
    store.getState().setDraft('带入草稿')
    let answer!: (value: boolean) => void
    vi.mocked(confirmDialog).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          answer = resolve
        })
    )
    const pending = store.getState().openSession('same-native-id', true)
    store.getState().setDraft('新输入')
    answer(true)
    await pending
    expect(store.getState().activeId).toBeNull()
    expect(store.getState().draft).toBe('新输入')
    await store.getState().openSession('same-native-id')
    expect(store.getState().draft).toBe('历史草稿')
  })
})
