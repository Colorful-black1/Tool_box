/** 统一桥接合成数据；不启动原生 CLI、不读真实配置或调用模型。 */
module.exports = function codingAgentsFixture() {
  const listeners = new Set()
  const states = new Map()
  const addedHistory = new Map()
  const externalReplies = new Map()
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
    'claude-desktop': 'Claude Desktop',
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
    const previous = nativeId
      ? [...state.sessions.values()].find((item) => item.nativeSessionId === nativeId)
      : null
    const ref = previous?.id ?? `${id}-ref-${++sequence}`
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
    if (previous) view.options = copy(previous.options)
    if (nativeId && externalReplies.has(id))
      view.messages.push({ id: 'external-reply', role: 'assistant', content: externalReplies.get(id) })
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
        return [
          { id: 'same-native-id', title: `${names[id]} 原生历史标题` },
          ...(addedHistory.get(id) ?? [])
        ]
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
      readCatalog: async ({ runtimeId: id, sessionId = '' }) => ({
        connectionId: states.get(id)?.info.connectionId ?? '',
        sessionId,
        commands:
          id === 'dsh'
            ? []
            : [
                {
                  id: 'compact',
                  name: 'compact',
                  kind: 'native',
                  description: '压缩上下文',
                  argumentHint: ''
                },
                {
                  id: 'init',
                  name: 'init',
                  kind: 'workflow',
                  description: '生成项目说明建议',
                  argumentHint: '',
                  targetFile: 'AGENTS.md'
                }
              ],
        skills:
          id === 'dsh'
            ? []
            : [
                {
                  id: 'fixture-skill',
                  kind: 'skill',
                  label: 'fixture-verify',
                  description: '项目校验 Skill'
                }
              ],
        mcp:
          id === 'dsh'
            ? []
            : [
                {
                  name: 'fixture-mcp',
                  status: 'connected',
                  tools: [
                    {
                      id: 'fixture-tool',
                      kind: 'tool',
                      label: 'search_docs',
                      description: '检索合成文档'
                    }
                  ]
                }
              ],
        notices: id === 'dsh' ? ['官方 DSH ACP 未提供命令与 MCP 状态查询'] : [],
        extensionsEnabled: states.get(id)?.extensionsEnabled ?? false
      }),
      searchFiles: async () => ({
        files: [
          { id: 'fixture-file', kind: 'file', label: 'src/中文 file.ts' },
          { id: 'fixture-file-2', kind: 'file', label: 'README.md' }
        ],
        limited: false
      }),
      setExtensions: async ({ runtimeId: id, enabled }) => {
        states.get(id).extensionsEnabled = enabled
      },
      executeCommand: async () => {
        throw new Error('合成界面通过发送路径执行命令')
      },
      send: async ({ runtimeId: id, sessionId, content, references, literal }) => {
        if (active) throw new Error('已有编程任务')
        if (content.startsWith('/') && !literal && !/^\/(compact|init)(\s|$)/.test(content))
          throw new Error('未识别为可用命令；可明确选择“作为普通文字发送”')
        calls.push({ action: 'send', id, content, references, literal })
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
      agentAddHistory: (id) => {
        addedHistory.set(id, [{ id: 'new-external-history', title: 'Desktop 后来新增的 Code 会话' }])
      },
      agentExternalReply: (id) => {
        externalReplies.set(id, 'Desktop 外部后来新增的回复')
      },
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
