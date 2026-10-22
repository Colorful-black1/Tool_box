/** 合成 OpenCode 桥接，不启动程序、不读取真实会话或模型配置。 */
module.exports = function opencodeFixture() {
  const listeners = new Set()
  const copy = (value) => JSON.parse(JSON.stringify(value))
  let info = {
    executablePath: 'C:\\合成程序\\resources\\opencode-cli.exe',
    version: null,
    directory: '',
    connected: false,
    canLoadSession: true,
    visibleModelIds: ['fixture/model-one', 'fixture/model-two']
  }
  const sessions = new Map()
  let sequence = 0
  let sent = 0
  let loaded = 0
  let failSend = false
  let lastSent = null
  const emit = (event) => listeners.forEach((listener) => listener(copy(event)))
  const update = (session) => emit({ kind: 'session', session })
  const current = () => [...sessions.values()].find((session) => session.status === 'running')
  const complete = () => {
    const session = current()
    if (!session) return
    session.messages.push({
      id: 'assistant-' + sent,
      role: 'assistant',
      content: '**合成回答**\n\n```java\nSystem.out.println("fixture");\n```'
    })
    session.status = 'ready'
    update(session)
  }
  return {
    controls: {
      codeSetDetectedExecutable: (path) => {
        info.executablePath = path
      },
      codeSendCount: () => sent,
      codeCreateCount: () => sequence,
      codeLoadCount: () => loaded,
      codeSetVisibleModels: (ids) => {
        info.visibleModelIds = ids
      },
      codeLastSent: () => copy(lastSent),
      codeComplete: complete,
      codeFailNextSend: () => {
        failSend = true
      },
      codePermission: () => {
        const session = current()
        session.approvals.push({
          id: 'approval-' + sent,
          title: '合成文件写入',
          details: '仅用于验收的操作预览',
          canAllow: true
        })
        session.tools.push({ id: 'tool-' + sent, title: '合成文件写入', status: 'pending' })
        update(session)
      }
    },
    bridge: {
      inspect: async () => copy(info),
      chooseExecutable: async () => copy(info),
      chooseDirectory: async () => 'E:\\合成项目',
      connect: async (directory) => {
        info = { ...info, directory, version: '2.1.1', connected: true }
        return copy(info)
      },
      disconnect: async () => {
        info.connected = false
        for (const session of sessions.values()) {
          session.status = 'disconnected'
          session.approvals = []
          update(session)
        }
        emit({ kind: 'connection', connected: false })
      },
      listSessions: async () => [{ id: 'saved-session', title: '合成历史会话' }],
      openSession: async (id) => {
        if (id) loaded++
        if (id && sessions.has(id)) {
          const session = sessions.get(id)
          session.status = 'ready'
          return copy(session)
        }
        const session = {
          id: id || 'code-' + ++sequence,
          title: id ? '合成历史会话' : '新编程会话',
          directory: info.directory,
          status: 'ready',
          messages: id ? [{ id: 'old', role: 'assistant', content: '合成历史正文' }] : [],
          tools: [],
          approvals: [],
          error: '',
          options: [
            {
              id: 'model',
              name: 'Model',
              category: 'model',
              currentValue: 'fixture/model-one',
              options: [
                { value: 'fixture/model-one', label: '合成模型一' },
                { value: 'fixture/model-two', label: '合成模型二' },
                { value: 'fixture/model-hidden', label: '合成隐藏模型' }
              ]
            },
            {
              id: 'mode',
              name: 'Mode',
              category: 'mode',
              currentValue: 'plan',
              options: [
                { value: 'plan', label: 'Plan' },
                { value: 'build', label: 'Build' }
              ]
            }
          ]
        }
        sessions.set(session.id, session)
        return copy(session)
      },
      setOption: async ({ sessionId, optionId, value }) => {
        const session = sessions.get(sessionId)
        session.options.find((option) => option.id === optionId).currentValue = value
        update(session)
        return copy(session)
      },
      send: async ({ sessionId, content }) => {
        if (failSend) {
          failSend = false
          throw new Error('合成发送失败，请重试')
        }
        const session = sessions.get(sessionId)
        session.messages.push({ id: 'user-' + ++sent, role: 'user', content })
        lastSent = { sessionId, content }
        session.status = 'running'
        update(session)
      },
      stop: async (id) => {
        const session = sessions.get(id)
        session.status = 'ready'
        session.approvals = []
        update(session)
      },
      approve: async ({ sessionId, approvalId, approved }) => {
        const session = sessions.get(sessionId)
        session.approvals = session.approvals.filter((item) => item.id !== approvalId)
        session.tools.at(-1).status = approved ? 'completed' : 'failed'
        update(session)
      },
      openDesktop: async () => undefined,
      onEvent: (listener) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      }
    }
  }
}
