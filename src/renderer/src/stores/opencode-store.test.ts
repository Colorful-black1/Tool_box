import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import type { OpenCodeInfo, OpenCodeSession } from '@shared/types'
import { useOpenCodeStore } from './opencode-store'

const info: OpenCodeInfo = {
  executablePath: '/fixture/opencode-cli',
  directory: '/fixture/project',
  version: '2.1.1',
  connected: true,
  canLoadSession: true,
  visibleModelIds: ['fixture/model-one']
}
const session: OpenCodeSession = {
  id: 's1',
  title: '合成会话',
  directory: info.directory,
  status: 'ready',
  messages: [],
  tools: [],
  options: [],
  approvals: [],
  error: ''
}
const api = {
  inspect: vi.fn(),
  connect: vi.fn(),
  openSession: vi.fn(),
  send: vi.fn(),
  stop: vi.fn(),
  approve: vi.fn(),
  setOption: vi.fn()
}
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('window', { toolbox: { opencode: api } })
  api.inspect.mockResolvedValue(info)
  api.connect.mockResolvedValue(info)
  api.openSession.mockResolvedValue(session)
  api.send.mockResolvedValue(undefined)
  useOpenCodeStore.setState({
    info: null,
    directory: '',
    sessions: {},
    activeId: null,
    history: [],
    draft: '',
    busy: false,
    error: ''
  })
})
afterEach(() => vi.unstubAllGlobals())

describe('OpenCode 工作台状态', () => {
  it('原生名称更新同时刷新已打开会话和历史选项，不切换会话或清空草稿', async () => {
    await useOpenCodeStore.getState().connect()
    await useOpenCodeStore.getState().openSession()
    useOpenCodeStore.setState({
      draft: '保留未发送草稿',
      history: [
        { id: session.id, title: '旧名称' },
        { id: 'other', title: '其他会话' }
      ]
    })
    useOpenCodeStore.getState().receive({
      kind: 'session',
      session: { ...session, title: 'OpenCode 原生名称' }
    })
    const state = useOpenCodeStore.getState()
    expect(state.sessions[session.id].title).toBe('OpenCode 原生名称')
    expect(state.history).toEqual([
      { id: session.id, title: 'OpenCode 原生名称' },
      { id: 'other', title: '其他会话' }
    ])
    expect(state.activeId).toBe(session.id)
    expect(state.draft).toBe('保留未发送草稿')
  })

  it('手动重新检测刷新缓存，保留已选择项目与草稿，不自动连接', async () => {
    api.inspect.mockResolvedValueOnce({ ...info, executablePath: null, directory: '' })
    await useOpenCodeStore.getState().inspect()
    useOpenCodeStore.setState({ directory: '/fixture/selected-project', draft: '保留草稿' })
    await useOpenCodeStore.getState().inspect()
    expect(api.inspect).toHaveBeenCalledTimes(1)
    expect(useOpenCodeStore.getState().info?.executablePath).toBeNull()
    await useOpenCodeStore.getState().inspect(true)
    expect(api.inspect).toHaveBeenCalledTimes(2)
    expect(useOpenCodeStore.getState().info?.executablePath).toBe(info.executablePath)
    expect(useOpenCodeStore.getState().directory).toBe('/fixture/selected-project')
    expect(useOpenCodeStore.getState().draft).toBe('保留草稿')
    expect(api.connect).not.toHaveBeenCalled()
    expect(api.send).not.toHaveBeenCalled()
  })

  it('检测失败释放处理中状态，允许重新检测恢复', async () => {
    api.inspect.mockRejectedValueOnce(new Error('合成检测失败'))
    await useOpenCodeStore.getState().inspect()
    expect(useOpenCodeStore.getState().busy).toBe(false)
    expect(useOpenCodeStore.getState().error).toBe('合成检测失败')
    await useOpenCodeStore.getState().inspect(true)
    expect(useOpenCodeStore.getState().info).toEqual(info)
    expect(useOpenCodeStore.getState().directory).toBe(info.directory)
    expect(useOpenCodeStore.getState().error).toBe('')
  })

  it('检查与连接不创建或恢复会话，也不自动发送草稿', async () => {
    useOpenCodeStore.getState().setDraft('合成任务')
    await useOpenCodeStore.getState().inspect()
    await useOpenCodeStore.getState().connect()
    expect(api.send).not.toHaveBeenCalled()
    expect(useOpenCodeStore.getState().draft).toBe('合成任务')
    expect(api.openSession).not.toHaveBeenCalled()
    expect(useOpenCodeStore.getState().activeId).toBeNull()
    expect(useOpenCodeStore.getState().sessions).toEqual({})
  })
  it('连接后必须手动新建或恢复历史，会话打开不自动发送', async () => {
    await useOpenCodeStore.getState().connect()
    await useOpenCodeStore.getState().openSession()
    expect(api.openSession).toHaveBeenLastCalledWith(undefined)
    expect(useOpenCodeStore.getState().activeId).toBe('s1')
    await useOpenCodeStore.getState().openSession('history')
    expect(api.openSession).toHaveBeenLastCalledWith('history')
    expect(api.send).not.toHaveBeenCalled()
  })
  it('发送失败保留草稿，重试成功后清空', async () => {
    await useOpenCodeStore.getState().connect()
    await useOpenCodeStore.getState().openSession()
    useOpenCodeStore.getState().setDraft('合成任务')
    api.send.mockRejectedValueOnce(new Error('fixture-private-detail'))
    await useOpenCodeStore.getState().send()
    expect(useOpenCodeStore.getState().draft).toBe('合成任务')
    expect(useOpenCodeStore.getState().error).not.toContain('private')
    await useOpenCodeStore.getState().send()
    expect(useOpenCodeStore.getState().draft).toBe('')
  })
  it('不同会话事件分别保存，不切换当前会话', async () => {
    await useOpenCodeStore.getState().connect()
    await useOpenCodeStore.getState().openSession()
    useOpenCodeStore
      .getState()
      .receive({ kind: 'session', session: { ...session, id: 's2', status: 'running' } })
    expect(useOpenCodeStore.getState().activeId).toBe('s1')
    expect(useOpenCodeStore.getState().sessions.s2.status).toBe('running')
  })
  it('桥接未就绪给出可读提示，内存草稿保持', async () => {
    vi.stubGlobal('window', {})
    useOpenCodeStore.getState().setDraft('合成内容')
    await useOpenCodeStore.getState().inspect()
    expect(useOpenCodeStore.getState().error).toContain('桥接未就绪')
    expect(useOpenCodeStore.getState().draft).toBe('合成内容')
  })
})
