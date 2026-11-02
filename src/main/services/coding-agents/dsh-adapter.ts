import { randomUUID } from 'node:crypto'
import { realpath, stat } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import type {
  CodingAgentRuntimeView,
  CodingAgentSessionSummary
} from '../../../shared/coding-agents'
import { normalizeDraftDirectory } from '../../../shared/agent-drafts'
import type { ToolboxStore } from '../chat-store/chat-store'
import {
  CodingAgentError,
  type CodingAgentAdapter,
  type NativeCodingEvent,
  type NativeCodingSession
} from './adapter'
import { acpObject } from './stdio-rpc-connection'
import { acpOptions, acpPreview, acpText, applyAcpUpdate } from './acp-codec'
import {
  attachDshWorkspace,
  detectDshExecutable,
  dshLaunchDirectory,
  dshSessionMessages,
  dshSessionMetadata,
  inspectDshExecutable,
  launchDsh
} from './dsh-runtime'
import { unavailableCatalog, type NativeAgentCatalog } from './agent-action-catalog'

/** 合成协议测试与本机 ACP 共用的最小传输契约。 */
export interface DshPeer {
  request(method: string, params: unknown, timeoutMs?: number): Promise<unknown>
  notify(method: string, params: unknown): void
  close(): void
}

/** 一个原生 prompt 的取消与结算边界。 */
interface DshRun {
  session: NativeCodingSession
  cancelled: boolean
  timer: NodeJS.Timeout | null
}

/** 官方 ACP 提交后更新；续接上下文与回放旧消息是分别声明的能力。 */
export class DshAdapter implements CodingAgentAdapter {
  async catalog(): Promise<NativeAgentCatalog> {
    return unavailableCatalog(
      '官方 DSH ACP 未提供命令 / Skill 列表及 MCP 状态查询；不支持手动压缩。项目文件通过路径引用交由 Agent 按权限读取。'
    )
  }
  readonly id = 'dsh' as const
  private peer: DshPeer | null = null
  private generation = 0
  private sessions = new Map<string, NativeCodingSession>()
  private listeners = new Set<(event: NativeCodingEvent) => void>()
  private approvals = new Map<string, { run: DshRun; settle(allowed: boolean): void }>()
  private run: DshRun | null = null
  private info: Omit<CodingAgentRuntimeView, 'connectionId'> = {
    runtimeId: 'dsh',
    name: 'DeepSeek Harness',
    executablePath: null,
    directory: '',
    version: null,
    available: true,
    connected: false,
    canLoadSession: false,
    visibleModelIds: [],
    detail: '通过官方 ACP 连接，操作权限沿用 DSH 原生规则。',
    capabilities: {
      history: 'unsupported',
      resume: 'unknown',
      subagents: 'unsupported',
      stopSubagent: 'unsupported',
      usage: 'unknown',
      desktopHistory: 'unknown'
    }
  }

  constructor(
    private readonly store: Pick<ToolboxStore, 'configGet' | 'configSet'>,
    private readonly launch: (...args: Parameters<typeof launchDsh>) => DshPeer = launchDsh
  ) {}
  subscribe(listener: (event: NativeCodingEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
  private emit(session: NativeCodingSession): void {
    for (const listener of this.listeners)
      listener({ kind: 'session', session: structuredClone(session) })
  }

  async inspect(): Promise<Omit<CodingAgentRuntimeView, 'connectionId'>> {
    if (!this.info.connected) {
      const generation = this.generation
      const config = acpObject(this.store.configGet()?.dsh)
      const executablePath = await detectDshExecutable(acpText(config?.executablePath, 4096))
      if (generation !== this.generation) throw new CodingAgentError('DSH 检测已失效，请重试')
      this.info.executablePath = executablePath
      this.info.directory = acpText(config?.directory, 4096)
    }
    return structuredClone(this.info)
  }
  async selectExecutable(path: string): Promise<Omit<CodingAgentRuntimeView, 'connectionId'>> {
    const spec = await inspectDshExecutable(path)
    this.info.executablePath = spec.path
    this.info.version = spec.version
    this.store.configSet({
      dsh: { ...acpObject(this.store.configGet()?.dsh), executablePath: spec.path }
    })
    return structuredClone(this.info)
  }
  async connect(directory: string): Promise<Omit<CodingAgentRuntimeView, 'connectionId'>> {
    if (!isAbsolute(directory) || !(await stat(directory).catch(() => null))?.isDirectory())
      throw new CodingAgentError('请选择存在的项目绝对目录')
    const cwd = await realpath(directory)
    this.disconnect()
    const generation = this.generation
    await this.inspect()
    if (!this.info.executablePath)
      throw new CodingAgentError('未找到 DSH，请选择官方 CLI 或 DeepSeek Harness.exe')
    const spec = await inspectDshExecutable(this.info.executablePath)
    if (generation !== this.generation) throw new CodingAgentError('DSH 连接已结束')
    const peer = this.launch(
      spec,
      dshLaunchDirectory(),
      (method, params) => {
        if (generation === this.generation) this.notification(method, params)
      },
      (method, params) =>
        generation === this.generation
          ? this.permission(method, params)
          : Promise.resolve({ outcome: { outcome: 'cancelled' } }),
      () => {
        if (generation === this.generation) {
          this.peer = null
          this.generation++
          this.lostConnection()
        }
      }
    )
    this.peer = peer
    try {
      const result = acpObject(
        await peer.request('initialize', {
          protocolVersion: 1,
          clientCapabilities: {},
          clientInfo: { name: 'Tool_box', version: '0.3.0' }
        })
      )
      const capabilities = acpObject(acpObject(result?.agentCapabilities)?.sessionCapabilities)
      if (
        result?.protocolVersion !== 1 ||
        !acpObject(capabilities?.list) ||
        !acpObject(capabilities?.resume) ||
        !acpObject(capabilities?.close)
      )
        throw new CodingAgentError('此 DSH 版本没有所需的 ACP 列表、续接和关闭接口，请升级官方程序')
      if (this.peer !== peer || generation !== this.generation)
        throw new CodingAgentError('DSH 连接已结束')
      this.info = {
        ...this.info,
        executablePath: spec.path,
        directory: cwd,
        version: spec.version,
        connected: true,
        canLoadSession: true,
        visibleModelIds: [],
        capabilities: { ...this.info.capabilities, resume: 'supported' }
      }
      this.store.configSet({ dsh: { ...acpObject(this.store.configGet()?.dsh), directory: cwd } })
      return structuredClone(this.info)
    } catch (error) {
      if (generation === this.generation && this.peer === peer) this.disconnect()
      else peer.close()
      throw error
    }
  }

  disconnect(): void {
    const peer = this.peer
    const ids = [...this.sessions.keys()]
    this.peer = null
    this.generation++
    this.lostConnection()
    this.sessions.clear()
    if (peer) {
      // 仅关闭本连接打开的会话；给原生持久化留出有界的排空时间。
      void Promise.allSettled(
        ids.map((sessionId) => peer.request('session/close', { sessionId }, 4000))
      ).finally(() => peer.close())
    }
  }
  private lostConnection(): void {
    if (this.run?.timer) clearTimeout(this.run.timer)
    for (const approval of [...this.approvals.values()]) approval.settle(false)
    this.run = null
    this.info.connected = false
    for (const listener of this.listeners) listener({ kind: 'connection', connected: false })
  }
  private connection(): DshPeer {
    if (!this.peer || !this.info.connected) throw new CodingAgentError('DSH 尚未连接')
    return this.peer
  }
  private session(id: string): NativeCodingSession {
    const session = this.sessions.get(id)
    if (!session || !this.info.connected)
      throw new CodingAgentError('DSH 会话已失效，请重新选择历史')
    return session
  }

  async listSessions(): Promise<CodingAgentSessionSummary[]> {
    const peer = this.connection()
    const items: Array<{ id: string; title: string }> = []
    const cursors = new Set<string>()
    let cursor: string | undefined
    for (let page = 0; page < 10; page++) {
      const response = acpObject(
        await peer.request('session/list', {
          cwd: this.info.directory,
          ...(cursor ? { cursor } : {})
        })
      )
      if (!Array.isArray(response?.sessions)) throw new CodingAgentError('DSH 历史摘要格式无效')
      for (const value of response.sessions.slice(0, 200)) {
        const item = acpObject(value)
        const id = acpText(item?.sessionId, 200)
        const cwd = acpText(item?.cwd, 4096)
        if (
          id &&
          cwd &&
          normalizeDraftDirectory(cwd) === normalizeDraftDirectory(this.info.directory) &&
          !items.some((entry) => entry.id === id)
        )
          items.push({ id, title: acpText(item?.title, 100) })
      }
      cursor = acpText(response.nextCursor, 200) || undefined
      if (!cursor || cursors.has(cursor)) break
      cursors.add(cursor)
    }
    const metadata = await dshSessionMetadata(items.map((item) => item.id))
    const result: CodingAgentSessionSummary[] = []
    for (const item of items) {
      const meta = metadata.get(item.id)
      if (meta?.blank || (meta && !meta.title && meta.lastPromptAt === null)) continue
      result.push({ id: item.id, title: meta?.title || item.title || 'DSH 历史会话' })
    }
    return result
  }

  attachWorkspace(sessionId: string, directory: string) {
    return attachDshWorkspace(sessionId, directory)
  }

  async openSession(id?: string): Promise<NativeCodingSession> {
    const peer = this.connection()
    let title = 'DSH 新会话'
    if (id) {
      const summary = (await this.listSessions()).find((item) => item.id === id)
      if (!summary) throw new CodingAgentError('此 DSH 会话不属于当前项目或已失效，草稿仍可取回')
      title = summary.title
    }
    let response: Record<string, unknown> | null
    try {
      response = acpObject(
        await peer.request(id ? 'session/resume' : 'session/new', {
          ...(id ? { sessionId: id } : {}),
          cwd: this.info.directory,
          mcpServers: []
        })
      )
    } catch (error) {
      if (!id) throw error
      const messages = await dshSessionMessages(id)
      const detail = error instanceof CodingAgentError ? error.message : 'DSH 会话不可用'
      const session: NativeCodingSession = {
        id,
        directory: this.info.directory,
        title,
        status: 'disconnected',
        messages,
        tools: [],
        approvals: [],
        options: [],
        error: `${detail}；历史正文已加载，关闭 Desktop 会话后可重试`
      }
      this.sessions.set(id, session)
      return structuredClone(session)
    }
    const sessionId = id ?? acpText(response?.sessionId, 200)
    if (!sessionId || this.peer !== peer)
      throw new CodingAgentError('DSH 未返回有效会话或连接已结束')
    const messages = id ? await dshSessionMessages(sessionId) : []
    const session: NativeCodingSession = {
      id: sessionId,
      directory: this.info.directory,
      title,
      status: 'ready',
      messages,
      tools: [],
      approvals: [],
      options: acpOptions(response?.configOptions),
      error: ''
    }
    this.sessions.set(sessionId, session)
    this.syncModels(session)
    return structuredClone(session)
  }
  private syncModels(session: NativeCodingSession): void {
    this.info.visibleModelIds = session.options
      .filter((item) => item.category === 'model')
      .flatMap((item) => item.options.map((choice) => choice.value))
    for (const listener of this.listeners)
      listener({ kind: 'runtime', runtime: structuredClone(this.info) })
  }
  async setOption(id: string, optionId: string, value: string): Promise<NativeCodingSession> {
    const session = this.session(id)
    if (this.run) throw new CodingAgentError('请先停止当前任务再切换选项')
    const option = session.options.find((option) => option.id === optionId)
    if (!option?.options.some((choice) => choice.value === value))
      throw new CodingAgentError('DSH 选项不可用')
    const result = acpObject(
      await this.connection().request('session/set_config_option', {
        sessionId: id,
        configId: optionId,
        value
      })
    )
    session.options = acpOptions(result?.configOptions)
    this.syncModels(session)
    return structuredClone(session)
  }
  send(id: string, content: string): void {
    const session = this.session(id)
    const peer = this.connection()
    if (this.run) throw new CodingAgentError('DSH 正在执行任务')
    const run: DshRun = { session, cancelled: false, timer: null }
    this.run = run
    session.status = 'running'
    session.outcome = null
    session.error = ''
    session.tools = []
    session.messages.push({ id: randomUUID(), role: 'user', content })
    this.emit(session)
    void peer
      .request(
        'session/prompt',
        { sessionId: id, prompt: [{ type: 'text', text: content }] },
        30 * 60_000
      )
      .then((value) => {
        if (this.run !== run || this.peer !== peer) return
        const reason = acpText(acpObject(value)?.stopReason)
        session.status =
          run.cancelled || reason === 'cancelled' || reason === 'end_turn' ? 'ready' : 'error'
        session.outcome =
          run.cancelled || reason === 'cancelled'
            ? 'stopped'
            : reason === 'end_turn'
              ? 'completed'
              : 'unknown'
        if (session.status === 'error')
          session.error = 'DSH 未正常结束，请在原生客户端检查任务状态和执行限制'
      })
      .catch(() => {
        if (this.run !== run) return
        session.status = 'error'
        session.outcome = 'unknown'
        session.error = 'DSH 请求中断，结果未知；请核对原生会话，不会自动重发'
      })
      .finally(() => {
        if (run.timer) clearTimeout(run.timer)
        for (const approval of [...this.approvals.values()])
          if (approval.run === run) approval.settle(false)
        if (this.run === run) {
          this.run = null
          this.emit(session)
        }
      })
  }
  stop(id: string): void {
    const run = this.run
    if (!run || run.session.id !== id || run.cancelled) return
    run.cancelled = true
    run.session.status = 'stopping'
    for (const approval of [...this.approvals.values()])
      if (approval.run === run) approval.settle(false)
    this.connection().notify('session/cancel', { sessionId: id })
    run.timer = setTimeout(() => {
      if (this.run === run) this.disconnect()
    }, 5000)
    this.emit(run.session)
  }
  approve(id: string, approvalId: string, approved: boolean): void {
    const approval = this.approvals.get(approvalId)
    if (!approval || approval.run !== this.run || approval.run.session.id !== id)
      throw new CodingAgentError('DSH 审批已失效')
    approval.settle(approved)
  }
  private permission(method: string, value: unknown): Promise<unknown> {
    if (method !== 'session/request_permission')
      return Promise.reject(new CodingAgentError('当前工作台暂不支持此 DSH 客户端请求'))
    const input = acpObject(value)
    const run = this.run
    if (!run || run.cancelled || input?.sessionId !== run.session.id)
      return Promise.resolve({ outcome: { outcome: 'cancelled' } })
    const choices = Array.isArray(input.options) ? input.options.slice(0, 20).map(acpObject) : []
    const allow = choices.find(
      (item) => item?.kind === 'allow_once' && typeof item.optionId === 'string'
    )
    const reject = choices.find(
      (item) => item?.kind === 'reject_once' && typeof item.optionId === 'string'
    )
    return new Promise((resolve) => {
      const id = randomUUID()
      const settle = (approved: boolean): void => {
        if (!this.approvals.has(id)) return
        this.approvals.delete(id)
        run.session.approvals = run.session.approvals.filter((item) => item.id !== id)
        const choice = approved ? allow : reject
        resolve(
          choice
            ? { outcome: { outcome: 'selected', optionId: choice.optionId } }
            : { outcome: { outcome: 'cancelled' } }
        )
        if (this.run === run) this.emit(run.session)
      }
      this.approvals.set(id, { run, settle })
      const tool = acpObject(input.toolCall)
      run.session.approvals.push({
        id,
        title: acpPreview(tool?.title ?? 'DSH 请求单次操作', 'DSH').slice(0, 200),
        details: acpPreview(tool?.rawInput ?? {}, 'DSH'),
        canAllow: Boolean(allow)
      })
      this.emit(run.session)
    })
  }
  private notification(method: string, value: unknown): void {
    if (method !== 'session/update') return
    const input = acpObject(value)
    const session = this.sessions.get(acpText(input?.sessionId, 200))
    if (!session) return
    const update = acpObject(input?.update)
    if (update?.sessionUpdate !== 'config_option_update' && this.run?.session !== session) return
    try {
      applyAcpUpdate(session, update, 'DSH')
      if (update?.sessionUpdate === 'config_option_update') this.syncModels(session)
      this.emit(session)
    } catch {
      // 分片结构异常只跳过本次推送；正文超限由 codec 裁剪并计数，不再停止任务。
    }
  }
}
