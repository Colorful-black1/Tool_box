import type { ToolboxBridge } from '@shared/bridge'
import type { OpenCodeEvent, OpenCodeInfo, OpenCodeSession } from '@shared/types'
import type {
  CodingAgentEvent,
  CodingAgentId,
  CodingAgentRuntimeView,
  CodingAgentSessionView
} from '@shared/coding-agents'

let legacyConnection = 'legacy-opencode'
let legacyRevision = 0
let legacyInfo: CodingAgentRuntimeView | null = null

/** 旧 preload 仅兼容 OpenCode，绝不把另一个 Agent 的请求转发给它。 */
function legacyApi(id: CodingAgentId) {
  if (id !== 'opencode') throw new Error('请重启更新后的桌面应用，再使用其他编程 Agent')
  if (!window.toolbox?.opencode) throw new Error('桌面桥接未就绪，请通过最新桌面应用运行')
  return window.toolbox.opencode
}

function runtime(info: OpenCodeInfo): CodingAgentRuntimeView {
  legacyInfo = {
    ...info,
    runtimeId: 'opencode',
    name: 'OpenCode',
    connectionId: legacyConnection,
    available: true,
    detail: '当前使用旧版桥接；其他 Agent 需要重启更新后的桌面应用',
    capabilities: {
      history: 'supported',
      resume: info.canLoadSession ? 'supported' : 'unknown',
      subagents: 'unknown',
      stopSubagent: 'unsupported',
      usage: 'unknown',
      desktopHistory: 'supported'
    }
  }
  return legacyInfo
}

function session(view: OpenCodeSession): CodingAgentSessionView {
  return {
    ...view,
    runtimeId: 'opencode',
    nativeSessionId: view.id,
    connectionId: legacyConnection,
    runId: null,
    revision: ++legacyRevision,
    outcome: null,
    subtasks: []
  }
}

/** 新旧桥接共用一个 renderer 入口，只订阅当前可用的一条事件流。 */
export function codingAgentClient(): ToolboxBridge['codingAgents'] {
  if (window.toolbox?.codingAgents) return window.toolbox.codingAgents
  return {
    listRuntimes: async () => [runtime(await legacyApi('opencode').inspect())],
    inspect: async (id) => runtime(await legacyApi(id).inspect()),
    chooseExecutable: async (id) => {
      const info = await legacyApi(id).chooseExecutable()
      return info ? runtime(info) : null
    },
    chooseDirectory: () => legacyApi('opencode').chooseDirectory(),
    connect: async ({ runtimeId, directory }) => {
      legacyConnection = `legacy-opencode-${++legacyRevision}`
      return runtime(await legacyApi(runtimeId).connect(directory))
    },
    disconnect: (id) => legacyApi(id).disconnect(),
    listSessions: (id) => legacyApi(id).listSessions(),
    createSession: async (id) => session(await legacyApi(id).openSession()),
    resumeSession: async ({ runtimeId, sessionId }) =>
      session(await legacyApi(runtimeId).openSession(sessionId)),
    setOption: async ({ runtimeId, ...input }) =>
      session(await legacyApi(runtimeId).setOption(input)),
    send: ({ runtimeId, ...input }) => legacyApi(runtimeId).send(input),
    stop: ({ runtimeId, sessionId }) => legacyApi(runtimeId).stop(sessionId),
    approve: ({ runtimeId, ...input }) => legacyApi(runtimeId).approve(input),
    openDesktop: (id) => legacyApi(id).openDesktop(),
    onEvent: (listener: (event: CodingAgentEvent) => void) => {
      const receive = (event: OpenCodeEvent): void => {
        if (event.kind === 'session') listener({ kind: 'session', session: session(event.session) })
        else if (legacyInfo)
          listener({
            kind: 'runtime',
            runtime: { ...legacyInfo, connected: event.connected },
            revision: ++legacyRevision
          })
      }
      return legacyApi('opencode').onEvent(receive)
    }
  }
}
