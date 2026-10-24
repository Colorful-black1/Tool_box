import { randomUUID } from 'node:crypto'
import {
  CODING_AGENT_IDS,
  CODING_AGENT_NAMES,
  type CodingAgentEvent,
  type CodingAgentId,
  type CodingAgentRuntimeView,
  type CodingAgentSessionView
} from '../../../shared/coding-agents'
import { IPC } from '../../../shared/ipc-contract'
import { OpenCodeError } from '../opencode/opencode-error'
import {
  CodingAgentError,
  type CodingAgentAdapter,
  type NativeCodingEvent,
  type NativeCodingSession
} from './adapter'

/** 未注册的运行时可见但不可执行，不用其他工具冒充。 */
export function unavailableRuntime(id: CodingAgentId): CodingAgentRuntimeView {
  return {
    runtimeId: id,
    name: CODING_AGENT_NAMES[id],
    executablePath: null,
    directory: '',
    version: null,
    connected: false,
    connectionId: '',
    available: false,
    detail: '此运行时尚未接入；不会自动安装或调用其他 Agent',
    canLoadSession: false,
    visibleModelIds: [],
    capabilities: {
      history: 'unknown',
      resume: 'unknown',
      subagents: 'unknown',
      stopSubagent: 'unknown',
      usage: 'unknown',
      desktopHistory: 'unknown'
    }
  }
}

/** 每个运行时只有一个连接所有者；连接 ID 与原生会话 ID 分离。 */
interface RuntimeState {
  adapter: CodingAgentAdapter
  info: CodingAgentRuntimeView
  owner: number | null
  busy: boolean
  revision: number
  legacySending: boolean
  sessions: Map<string, CodingAgentSessionView>
  dispose(): void
}

/** 仅记录一个顶层运行；原生内部子代理不再由 Tool_box 二次调度。 */
interface ActiveRun {
  runtimeId: CodingAgentId
  sessionRef: string
  runId: string
}

/** 原生适配边界：路由、所有权、互斥与事件身份在此收敛，不持久化正文。 */
export class CodingAgentService {
  private readonly runtimes = new Map<CodingAgentId, RuntimeState>()
  private readonly listeners = new Set<(owner: number, event: CodingAgentEvent) => void>()
  private active: ActiveRun | null = null

  constructor(adapters: CodingAgentAdapter[]) {
    for (const adapter of adapters) {
      const state: RuntimeState = {
        adapter,
        info: unavailableRuntime(adapter.id),
        owner: null,
        busy: false,
        revision: 0,
        legacySending: false,
        sessions: new Map(),
        dispose: () => undefined
      }
      this.runtimes.set(adapter.id, state)
      state.dispose = adapter.subscribe((event) => this.receive(state, event))
    }
  }

  subscribe(listener: (owner: number, event: CodingAgentEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async listRuntimes(owner: number): Promise<CodingAgentRuntimeView[]> {
    return Promise.all(CODING_AGENT_IDS.map((id) => this.inspect(id, owner)))
  }

  async inspect(id: CodingAgentId, owner: number): Promise<CodingAgentRuntimeView> {
    const state = this.runtimes.get(id)
    if (!state) return unavailableRuntime(id)
    this.requireOwner(state, owner)
    return this.updateInfo(state, await state.adapter.inspect())
  }

  selectExecutable(
    id: CodingAgentId,
    owner: number,
    path: string
  ): Promise<CodingAgentRuntimeView> {
    const state = this.requireRuntime(id)
    return this.operate(state, owner, true, async () => {
      if (state.info.connected) throw new CodingAgentError('请先断开当前 Agent 再更换程序')
      return this.updateInfo(state, await state.adapter.selectExecutable(path))
    })
  }

  connect(id: CodingAgentId, owner: number, directory: string): Promise<CodingAgentRuntimeView> {
    const state = this.requireRuntime(id)
    return this.operate(state, owner, true, async () => {
      this.prepareConnection(state, owner)
      try {
        return this.updateInfo(state, await state.adapter.connect(directory))
      } catch (error) {
        state.adapter.disconnect()
        throw error
      }
    })
  }

  disconnect(id: CodingAgentId, owner: number): void {
    const state = this.requireRuntime(id)
    this.requireOwner(state, owner)
    if (state.busy) throw new CodingAgentError('Agent 正在处理操作，请稍后断开')
    state.adapter.disconnect()
    state.owner = null
  }

  listSessions(id: CodingAgentId, owner: number) {
    const state = this.connected(id, owner)
    return state.adapter.listSessions()
  }

  openSession(
    id: CodingAgentId,
    owner: number,
    nativeId?: string
  ): Promise<CodingAgentSessionView> {
    const state = this.connected(id, owner)
    return this.operate(state, owner, true, async () => {
      const connectionId = state.info.connectionId
      if (nativeId && !state.info.canLoadSession)
        throw new CodingAgentError('当前 Agent 不支持恢复会话')
      const session = await state.adapter.openSession(nativeId)
      if (connectionId !== state.info.connectionId || !state.info.connected)
        throw new CodingAgentError('连接已结束，请重新选择原生会话')
      return this.upsert(state, session)
    })
  }

  setOption(id: CodingAgentId, owner: number, ref: string, option: string, value: string) {
    const state = this.connected(id, owner)
    return this.operate(state, owner, true, async () => {
      const session = this.session(state, ref)
      return this.upsert(
        state,
        await state.adapter.setOption(session.nativeSessionId, option, value)
      )
    })
  }

  async send(id: CodingAgentId, owner: number, ref: string, content: string): Promise<void> {
    const state = this.connected(id, owner)
    return this.operate(state, owner, true, async () => {
      const session = this.session(state, ref)
      if (session.status !== 'ready' && session.status !== 'error')
        throw new CodingAgentError('该会话暂时不能发送，请等待或重新选择历史会话')
      this.begin(state, session)
      try {
        await state.adapter.send(session.nativeSessionId, content)
      } catch (error) {
        if (this.active?.runId === session.runId) {
          this.active = null
          session.status = state.info.connected ? 'error' : 'disconnected'
          session.outcome = state.info.connected ? 'failed' : 'unknown'
          session.error = this.errorText(error)
          this.publishSession(state, session)
        }
        throw error
      }
    })
  }

  async stop(id: CodingAgentId, owner: number, ref: string): Promise<void> {
    const state = this.connected(id, owner)
    const session = this.session(state, ref)
    if (session.status !== 'running') return
    session.status = 'stopping'
    this.publishSession(state, session)
    try {
      await state.adapter.stop(session.nativeSessionId)
    } catch (error) {
      const current = this.session(state, ref)
      if (state.info.connected && current.status === 'stopping') {
        current.status = 'running'
        current.error = this.errorText(error)
        this.publishSession(state, current)
      }
      throw error
    }
  }

  approve(
    id: CodingAgentId,
    owner: number,
    ref: string,
    approvalId: string,
    approved: boolean
  ): void {
    const state = this.connected(id, owner)
    const session = this.session(state, ref)
    if (this.active?.runId !== session.runId || !session.approvals.some((a) => a.id === approvalId))
      throw new CodingAgentError('该审批已结束或不属于当前运行')
    state.adapter.approve(session.nativeSessionId, approvalId, approved)
  }

  /** 旧 OpenCode IPC 经过同一把互斥与所有权检查，避免与 Codex 并发绕过。 */
  runLegacy<T>(owner: number, channel: string, action: () => T | Promise<T>): Promise<T> {
    const state = this.requireRuntime('opencode')
    const read = new Set<string>([
      IPC.opencodeInspect,
      IPC.opencodeSessions,
      IPC.opencodeDesktop,
      IPC.opencodeDisconnect
    ]).has(channel)
    const control = channel === IPC.opencodeStop || channel === IPC.opencodeApprove
    return this.operate(
      state,
      owner,
      !read && !control,
      async () => {
        if (channel === IPC.opencodeConnect) this.prepareConnection(state, owner)
        state.legacySending = channel === IPC.opencodeSend
        try {
          const value = await action()
          if (
            new Set<string>([IPC.opencodeInspect, IPC.opencodeConnect, IPC.opencodeExecutable]).has(
              channel
            )
          )
            this.updateInfo(state, await state.adapter.inspect())
          if (channel === IPC.opencodeDisconnect) state.owner = null
          return value
        } finally {
          state.legacySending = false
        }
      },
      control
    )
  }

  ownsOpenCode(owner: number): boolean {
    return this.runtimes.get('opencode')?.owner === owner
  }

  releaseOwner(owner: number): void {
    for (const state of this.runtimes.values()) {
      if (state.owner !== owner) continue
      state.adapter.disconnect()
      state.owner = null
    }
  }

  dispose(): void {
    for (const state of this.runtimes.values()) {
      state.adapter.disconnect()
      state.dispose()
    }
    this.listeners.clear()
  }

  private requireRuntime(id: CodingAgentId): RuntimeState {
    const state = this.runtimes.get(id)
    if (!state) throw new CodingAgentError('此 Agent 尚未接入，请选择已支持的运行时')
    return state
  }

  private requireOwner(state: RuntimeState, owner: number): void {
    if (state.owner !== null && state.owner !== owner)
      throw new CodingAgentError('该 Agent 连接由另一个窗口管理，请在原窗口操作')
  }

  private connected(id: CodingAgentId, owner: number): RuntimeState {
    const state = this.requireRuntime(id)
    this.requireOwner(state, owner)
    if (!state.info.connected || state.owner === null)
      throw new CodingAgentError('请先连接所选 Agent')
    return state
  }

  private session(state: RuntimeState, ref: string): CodingAgentSessionView {
    const session = [...state.sessions.values()].find((item) => item.id === ref)
    if (!session || session.connectionId !== state.info.connectionId)
      throw new CodingAgentError('会话已失效，请重新选择历史会话')
    return session
  }

  private async operate<T>(
    state: RuntimeState,
    owner: number,
    idle: boolean,
    action: () => T | Promise<T>,
    control = false
  ): Promise<T> {
    this.requireOwner(state, owner)
    if (state.busy && !control) throw new CodingAgentError('Agent 正在处理操作，请稍候')
    if (idle && this.active) throw new CodingAgentError('请先等待或停止正在运行的编程任务')
    if (!control) state.busy = true
    try {
      return await action()
    } finally {
      if (!control) state.busy = false
    }
  }

  private prepareConnection(state: RuntimeState, owner: number): void {
    state.adapter.disconnect()
    state.sessions.clear()
    state.owner = owner
    state.info = { ...state.info, connected: false, connectionId: randomUUID() }
    this.publishRuntime(state)
  }

  private updateInfo(state: RuntimeState, info: Omit<CodingAgentRuntimeView, 'connectionId'>) {
    state.info = { ...info, connectionId: state.info.connectionId }
    this.publishRuntime(state)
    return structuredClone(state.info)
  }

  private begin(state: RuntimeState, session: CodingAgentSessionView): void {
    session.runId = randomUUID()
    session.outcome = null
    session.error = ''
    this.active = { runtimeId: state.adapter.id, sessionRef: session.id, runId: session.runId }
  }

  private receive(state: RuntimeState, event: NativeCodingEvent): void {
    if (event.kind === 'connection') {
      if (!event.connected) {
        state.info.connected = false
        for (const session of state.sessions.values()) {
          if (session.status === 'running' || session.status === 'stopping') {
            session.outcome = 'unknown'
            session.error = '连接中断，任务结果未知；请核对原生会话，不会自动重发'
            for (const child of session.subtasks)
              if (!['completed', 'errored', 'shutdown', 'interrupted'].includes(child.status))
                child.status = 'unknown'
          }
          session.status = 'disconnected'
          this.publishSession(state, session)
        }
        if (this.active?.runtimeId === state.adapter.id) this.active = null
        this.publishRuntime(state)
      }
      return
    }
    this.upsert(state, event.session)
  }

  private upsert(state: RuntimeState, raw: NativeCodingSession): CodingAgentSessionView {
    const previous = state.sessions.get(raw.id)
    const view: CodingAgentSessionView = {
      ...structuredClone(raw),
      id: previous?.id ?? randomUUID(),
      nativeSessionId: raw.id,
      runtimeId: state.adapter.id,
      connectionId: state.info.connectionId,
      revision: 0,
      runId: previous?.runId ?? null,
      outcome: previous?.outcome ?? null,
      subtasks: structuredClone(raw.subtasks ?? [])
    }
    if (raw.status === 'running' && !this.active && state.legacySending) this.begin(state, view)
    const active = this.active?.sessionRef === view.id
    if (active && raw.status !== 'running' && raw.status !== 'stopping') {
      view.outcome =
        raw.outcome ??
        (raw.status === 'disconnected'
          ? 'unknown'
          : raw.status === 'error'
            ? 'failed'
            : previous?.status === 'stopping'
              ? 'stopped'
              : 'completed')
      this.active = null
    } else if (!active && previous?.outcome !== null && previous?.outcome !== undefined) {
      // 已结算后的标题 / 配置可更新，迟到正文与工具分片不能复活或污染运行。
      view.messages = previous.messages
      view.tools = previous.tools
      view.subtasks = previous.subtasks
      view.status = raw.status === 'disconnected' ? raw.status : previous.status
    }
    state.sessions.set(raw.id, view)
    this.publishSession(state, view)
    return structuredClone(view)
  }

  private publishSession(state: RuntimeState, session: CodingAgentSessionView): void {
    session.revision = ++state.revision
    this.emit(state, { kind: 'session', session: structuredClone(session) })
  }

  private publishRuntime(state: RuntimeState): void {
    this.emit(state, {
      kind: 'runtime',
      runtime: structuredClone(state.info),
      revision: ++state.revision
    })
  }

  private emit(state: RuntimeState, event: CodingAgentEvent): void {
    if (state.owner === null) return
    for (const listener of this.listeners) listener(state.owner, event)
  }

  private errorText(error: unknown): string {
    return error instanceof CodingAgentError || error instanceof OpenCodeError
      ? error.message
      : 'Agent 操作失败，请检查运行时和登录状态后重试'
  }
}
