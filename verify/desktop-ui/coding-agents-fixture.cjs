/** 统一桥接合成数据；不启动原生 CLI、不读真实配置或调用模型。 */
module.exports = function codingAgentsFixture() {
  const listeners = new Set()
  const states = new Map()
  let sequence = 0,
    revision = 0,
    active = null,
    failHistory = false
  const calls = []
  const names = {
    opencode: 'OpenCode',
    codex: 'Codex',
    kimi: 'Kimi Code',
    claude: 'Claude Code',
    dsh: 'DeepSeek Harness'
  }
  const copy = (value) => JSON.parse(JSON.stringify(value))
  const info = (id) =>
    states.get(id)?.info ?? {
      runtimeId: id,
      name: names[id],
      directory: id === 'codex' ? 'E:\\合成项目' : '',
      executablePath: id !== 'kimi' ? `C:\\合成程序\\${id}.exe` : null,
      version: 'fixture',
      connected: false,
      connectionId: '',
      available: id !== 'kimi',
      detail: id === 'kimi' ? '此运行时尚未接入；不会自动安装或调用其他 Agent' : '原生程序已检测',
      canLoadSession: true,
      visibleModelIds: ['fixture/model'],
      capabilities: {
        history: id === 'dsh' ? 'unsupported' : 'supported',
        resume: 'supported',
        subagents: id === 'codex' ? 'supported' : 'unknown',
        stopSubagent: 'unsupported',
        usage: 'unknown',
        desktopHistory: 'unknown'
      }
    }
  const emit = (event) => listeners.forEach((listener) => listener(copy(event)))
  const publish = (view) => {
    view.revision = ++revision
    emit({ kind: 'session', session: view })
    return copy(view)
  }
  const open = (id, nativeId) => {
    const state = states.get(id)
    const ref = `${id}-ref-${++sequence}`
    const view = {
      id: ref,
      nativeSessionId: nativeId || `${id}-native-${sequence}`,
      runtimeId: id,
      connectionId: state.info.connectionId,
      runId: null,
      revision: 0,
      title: nativeId ? `${names[id]} 原生历史标题` : `${names[id]} 新会话`,
      directory: state.info.directory,
      status: 'ready',
      outcome: null,
      messages:
        nativeId && id !== 'dsh'
          ? [
              { id: 'u1', role: 'user', content: '检查 Java 并发边界' },
              { id: 'a1', role: 'assistant', content: '已完成实现，请检查停止与审批边界。' }
            ]
          : [],
      tools: [],
      approvals: [],
      subtasks: [],
      error: '',
      options: [
        {
          id: 'model',
          name: '模型',
          category: 'model',
          currentValue: 'fixture/model',
          options: [{ value: 'fixture/model', label: '原生可选模型' }]
        },
        {
          id: 'mode',
          name: id === 'codex' ? '操作权限' : '工作模式',
          category: id === 'codex' ? 'permission' : 'mode',
          currentValue: id === 'codex' ? 'read-only' : 'plan',
          options: [
            {
              value: id === 'codex' ? 'read-only' : 'plan',
              label: id === 'codex' ? '只读 · 升级需审批' : 'Plan'
            }
          ]
        }
      ]
    }
    state.sessions.set(ref, view)
    return publish(view)
  }
  return {
    bridge: {
      listRuntimes: async () => Object.keys(names).map((id) => copy(info(id))),
      inspect: async (id) => copy(info(id)),
      chooseDirectory: async () => 'E:\\合成项目',
      chooseExecutable: async (id) => copy(info(id)),
      connect: async ({ runtimeId: id, directory }) => {
        calls.push({ action: 'connect', id })
        const view = {
          ...info(id),
          directory,
          connected: true,
          connectionId: `connection-${++sequence}`
        }
        states.set(id, { info: view, sessions: new Map() })
        return copy(view)
      },
      disconnect: async (id) => {
        const state = states.get(id)
        state.info.connected = false
        emit({ kind: 'runtime', runtime: state.info, revision: ++revision })
      },
      listSessions: async (id) => {
        calls.push({ action: 'list', id })
        if (failHistory) {
          failHistory = false
          throw new Error('合成历史读取失败')
        }
        return [{ id: 'same-native-id', title: `${names[id]} 原生历史标题` }]
      },
      createSession: async (id) => {
        calls.push({ action: 'create', id })
        return open(id)
      },
      resumeSession: async ({ runtimeId: id, sessionId }) => {
        calls.push({ action: 'resume', id })
        return open(id, sessionId)
      },
      setOption: async ({ runtimeId: id, sessionId }) =>
        copy(states.get(id).sessions.get(sessionId)),
      send: async ({ runtimeId: id, sessionId, content }) => {
        if (active) throw new Error('已有编程任务')
        calls.push({ action: 'send', id, content })
        const view = states.get(id).sessions.get(sessionId)
        active = view
        view.status = 'running'
        view.runId = `run-${++sequence}`
        view.messages.push({ id: `user-${sequence}`, role: 'user', content })
        publish(view)
      },
      stop: async ({ runtimeId: id, sessionId }) => {
        calls.push({ action: 'stop', id, sessionId })
        if (active) {
          active.status = 'ready'
          active.outcome = 'stopped'
          publish(active)
          active = null
        }
      },
      approve: async () => undefined,
      openDesktop: async () => undefined,
      onEvent: (listener) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      }
    },
    controls: {
      agentCalls: () => copy(calls),
      agentFailHistory: () => {
        failHistory = true
      },
      agentDelta: (text) => {
        if (!active) return
        let last = active.messages.at(-1)
        if (last.role !== 'assistant') {
          last = { id: `answer-${sequence}`, role: 'assistant', content: '' }
          active.messages.push(last)
        }
        last.content += text
        active.subtasks = [{ id: 'native-child', title: '检查器', status: 'running', result: '' }]
        publish(active)
      },
      agentFinish: () => {
        if (active) {
          active.status = 'ready'
          active.outcome = 'completed'
          publish(active)
          active = null
        }
      }
    }
  }
}
