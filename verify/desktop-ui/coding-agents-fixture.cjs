/** 统一桥接合成数据；不启动原生 CLI、不读真实配置或调用模型。 */
module.exports = function codingAgentsFixture() {
  const listeners = new Set()
  const states = new Map()
  const projects = new Map()
  const addedHistory = new Map()
  const externalReplies = new Map()
  const active = new Map()
  const revertPreviews = new Map()
  let nextDirectory = 'E:\\合成项目'
  let sequence = 0,
    revision = 0,
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
          id: 'thought_level',
          name: '思考强度',
          category: 'thought_level',
          currentValue: 'default',
          options: [
            { value: 'default', label: 'Default' },
            { value: 'high', label: 'High' }
          ]
        },
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
      view.messages.push({
        id: 'external-reply',
        role: 'assistant',
        content: externalReplies.get(id)
      })
    state.sessions.set(ref, view)
    return publish(view)
  }
  return {
    bridge: {
      listRuntimes: async () => Object.keys(names).map((id) => copy(info(id))),
      inspect: async (id) =>
        copy({ ...info(id), projectDirectory: projects.get(id) ?? info(id).directory }),
      chooseDirectory: async (id) => {
        if (id) projects.set(id, nextDirectory)
        return nextDirectory
      },
      selectProject: async ({ runtimeId: id, directory }) => {
        calls.push({ action: 'project', id, directory })
        projects.set(id, directory)
        return directory
      },
      chooseExecutable: async (id) => copy(info(id)),
      connect: async ({ runtimeId: id, directory }) => {
        calls.push({ action: 'connect', id, directory })
        projects.set(id, directory)
        const view = {
          ...info(id),
          directory,
          projectDirectory: directory,
          connected: true,
          connectionId: `connection-${++sequence}`
        }
        states.set(id, { info: view, sessions: new Map() })
        return copy(view)
      },
      disconnect: async (id) => {
        const state = states.get(id)
        const run = active.get(id)
        if (run) {
          run.status = 'disconnected'
          run.outcome = 'unknown'
          publish(run)
          active.delete(id)
        }
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
      setOption: async ({ runtimeId: id, sessionId, optionId, value }) => {
        const view = states.get(id).sessions.get(sessionId)
        const option = view.options.find((item) => item.id === optionId)
        if (!option?.options.some((item) => item.value === value)) throw new Error('合成选项无效')
        calls.push({ action: 'option', id, optionId, value })
        option.currentValue = value
        return publish(view)
      },
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
        if (active.has(id)) throw new Error('当前 Agent 已有编程任务')
        if (content.startsWith('/') && !literal && !/^\/(compact|init)(\s|$)/.test(content))
          throw new Error('未识别为可用命令；可明确选择“作为普通文字发送”')
        calls.push({ action: 'send', id, content, references, literal })
        const view = states.get(id).sessions.get(sessionId)
        active.set(id, view)
        view.status = 'running'
        view.outcome = null
        view.timing = { startedAt: Date.now() }
        view.runId = `run-${++sequence}`
        view.messages.push({ id: `user-${sequence}`, role: 'user', content })
        publish(view)
      },
      stop: async ({ runtimeId: id, sessionId }) => {
        calls.push({ action: 'stop', id, sessionId })
        const run = active.get(id)
        if (run && run.id === sessionId) {
          run.status = 'ready'
          run.outcome = 'stopped'
          run.questions = []
          run.timing = { ...run.timing, elapsedMs: 1700, finishedAt: Date.now() }
          publish(run)
          active.delete(id)
        }
      },
      approve: async () => undefined,
      previewRevert: async ({ runtimeId: id, sessionId, messageId }) => {
        const view = states.get(id).sessions.get(sessionId)
        const index = view.messages.findIndex(
          (message) => message.id === messageId && message.role === 'user'
        )
        if (!view.canRevert || index < 0 || active.has(id)) throw new Error('合成回退目标失效')
        const token = `preview-${++sequence}`
        revertPreviews.set(token, { id, sessionId, index, messages: JSON.stringify(view.messages) })
        calls.push({ action: 'preview-revert', id })
        return {
          token,
          historyRevision: 'fixture',
          affectedTurns: view.messages.slice(index).filter((message) => message.role === 'user')
            .length,
          affectedMessages: view.messages.length - index,
          tail: copy(view.messages.slice(index)),
          originalText: view.messages[index].content
        }
      },
      revert: async ({ runtimeId: id, sessionId, token }) => {
        const preview = revertPreviews.get(token)
        const view = states.get(id).sessions.get(sessionId)
        if (
          !preview ||
          preview.id !== id ||
          preview.sessionId !== sessionId ||
          active.has(id) ||
          preview.messages !== JSON.stringify(view.messages)
        )
          throw new Error('合成预览失效')
        revertPreviews.delete(token)
        calls.push({ action: 'revert', id })
        view.messages = view.messages.slice(0, preview.index)
        view.status = 'ready'
        view.outcome = 'completed'
        delete view.contextUsage
        delete view.timing
        return publish(view)
      },
      answerQuestion: async ({ runtimeId: id, sessionId, ...answer }) => {
        const run = active.get(id)
        if (
          !run ||
          run.id !== sessionId ||
          !run.questions?.some((item) => item.id === answer.requestId)
        )
          throw new Error('问题已失效')
        calls.push({ action: 'answer', id, ...answer })
        run.questions = run.questions.filter((item) => item.id !== answer.requestId)
        publish(run)
      },
      openDesktop: async () => undefined,
      onEvent: (listener) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      }
    },
    controls: {
      agentSessionMetadata: (id, patch) => {
        const state = states.get(id)
        const view = active.get(id) ?? [...(state?.sessions.values() ?? [])].at(-1)
        if (!view) throw new Error('缺少合成会话')
        Object.assign(view, copy(patch))
        if (patch.outcome && patch.outcome !== null) active.delete(id)
        publish(view)
      },
      agentCalls: () => copy(calls),
      agentDirectory: (directory) => {
        nextDirectory = directory
      },
      agentAddHistory: (id) => {
        addedHistory.set(id, [
          { id: 'new-external-history', title: 'Desktop 后来新增的 Code 会话' }
        ])
      },
      agentExternalReply: (id) => {
        externalReplies.set(id, 'Desktop 外部后来新增的回复')
      },
      agentFailHistory: () => {
        failHistory = true
      },
      agentDelta: (text, id) => {
        const run = id ? active.get(id) : [...active.values()].at(-1)
        if (!run) return
        let last = run.messages.at(-1)
        if (last.role !== 'assistant') {
          last = { id: `answer-${sequence}`, role: 'assistant', content: '' }
          run.messages.push(last)
        }
        last.content += text
        run.subtasks = [{ id: 'native-child', title: '检查器', status: 'running', result: '' }]
        publish(run)
      },
      agentFinish: (id) => {
        const run = id ? active.get(id) : [...active.values()].at(-1)
        if (run) {
          run.status = 'ready'
          run.outcome = 'completed'
          run.questions = []
          run.timing = { ...run.timing, elapsedMs: 2600, finishedAt: Date.now() }
          publish(run)
          active.delete(run.runtimeId)
        }
      }
    }
  }
}
