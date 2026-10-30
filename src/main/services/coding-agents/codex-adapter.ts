import { randomUUID } from 'node:crypto'
import { codexContextUsage } from './agent-session-metrics'
import { AgentQuestions, nativeQuestions } from './agent-questions'
import { nativeForm } from './agent-elicitation'
import { codexRevertPreview, readCodexHistory } from './codex-history'
import { inspectCodexRevert } from './codex-revert-capability'
import type { NativeRevertPreview } from './adapter'
import type { AgentQuestionAnswer } from '../../../shared/agent-session'
import { realpath, stat } from 'node:fs/promises'
import { isAbsolute, normalize } from 'node:path'
import type {
  CodingAgentRuntimeView,
  CodingAgentSessionSummary
} from '../../../shared/coding-agents'
import type { ToolboxStore } from '../chat-store/chat-store'
import {
  CodingAgentError,
  CodingAgentHistoryUnknownError,
  type CodingAgentAdapter,
  type NativeCodingEvent,
  type NativeCodingSession
} from './adapter'
import type { NativeSendContext } from './adapter'
import { nativeCommands, type NativeAgentCatalog } from './agent-action-catalog'
import { codexObject, codexText } from './codex-connection'
import {
  applyCodexItem,
  codexMessage,
  codexModels,
  codexOptions,
  codexPreview,
  codexTitle,
  type CodexModel
} from './codex-codec'
import { detectCodexExecutable, inspectCodexExecutable, launchCodex } from './codex-runtime'

/** 可注入合成传输；生产环境只启动本机 Codex App Server。 */
export interface CodexPeer {
  request(method: string, params: unknown, timeoutMs?: number): Promise<unknown>
  notify(method: string, params: unknown): void
  close(): void
}

/** 一次原生 turn 的身份及停止看门狗；终态后拒绝迟到消息。 */
interface CodexRun {
  compacting?: boolean
  session: NativeCodingSession
  turnId: string | null
  clientId: string
  timer: NodeJS.Timeout
  pending: Array<{ method: string; params: unknown }>
  ready: Promise<string | null>
  resolveReady(id: string | null): void
}

/** 独立使用 Codex 原生 profile；不从其他 Agent 复制密钥或配置。 */
export class CodexAdapter implements CodingAgentAdapter {
  private readonly questions = new AgentQuestions((session) => this.publish(session, true))
  private readonly questionRequests = new Map<string, string>()
  private readonly resolvedQuestions = new Set<string>()
  private readonly userTurns = new Map<string, string>()
  private readonly uncertainReverts = new Set<string>()
  private revertSupported = false
  readonly id = 'codex' as const
  private peer: CodexPeer | null = null
  private generation = 0
  private connecting = false
  private models: CodexModel[] = []
  private readonly sessions = new Map<string, NativeCodingSession>()
  private readonly listeners = new Set<(event: NativeCodingEvent) => void>()
  private readonly approvals = new Map<
    string,
    { sessionId: string; settle(allow: boolean): void }
  >()
  private readonly updates = new Map<string, NodeJS.Timeout>()
  private run: CodexRun | null = null
  private info: Omit<CodingAgentRuntimeView, 'connectionId'> = {
    runtimeId: 'codex',
    name: 'Codex',
    executablePath: null,
    directory: '',
    version: null,
    connected: false,
    available: true,
    detail: '复用本机 Codex CLI 和原生登录；不会自动发送任务',
    canLoadSession: true,
    visibleModelIds: [],
    capabilities: {
      history: 'supported',
      resume: 'supported',
      subagents: 'supported',
      stopSubagent: 'unsupported',
      usage: 'unknown',
      desktopHistory: 'unknown'
    }
  }

  constructor(
    private readonly store: Pick<ToolboxStore, 'configGet' | 'configSet'>,
    private readonly launch: (...args: Parameters<typeof launchCodex>) => CodexPeer = launchCodex
  ) {}

  subscribe(listener: (event: NativeCodingEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async inspect(): Promise<Omit<CodingAgentRuntimeView, 'connectionId'>> {
    if (!this.info.connected) {
      const preferences = codexObject(this.store.configGet()?.codex)
      this.info.executablePath = await detectCodexExecutable(
        codexText(preferences?.executablePath, 4096)
      )
      this.info.directory = codexText(preferences?.directory, 4096)
    } else {
      const peer = this.requirePeer()
      const models = await this.readModels(peer)
      if (peer !== this.peer) throw new CodingAgentError('Codex 连接已结束')
      this.models = models
      this.info.visibleModelIds = models.map((item) => item.id)
      for (const session of this.sessions.values()) {
        const model = session.options.find((item) => item.id === 'model')?.currentValue
        const effort = session.options.find((item) => item.id === 'effort')?.currentValue
        const permission = session.options.find((item) => item.id === 'permission')?.currentValue
        session.options = codexOptions(models, model, effort)
        session.options.find((item) => item.id === 'permission')!.currentValue =
          permission ?? 'read-only'
        this.publish(session, true)
      }
    }
    return structuredClone(this.info)
  }

  async selectExecutable(path: string): Promise<Omit<CodingAgentRuntimeView, 'connectionId'>> {
    if (this.peer || this.connecting) throw new CodingAgentError('请先断开 Codex 再更换程序')
    const executable = await inspectCodexExecutable(path)
    this.info.executablePath = executable.path
    this.info.version = executable.version
    this.savePreferences()
    return structuredClone(this.info)
  }

  async connect(directory: string): Promise<Omit<CodingAgentRuntimeView, 'connectionId'>> {
    if (this.connecting) throw new CodingAgentError('Codex 正在连接，请稍候')
    if (this.run) throw new CodingAgentError('请先停止当前任务')
    this.disconnect()
    this.connecting = true
    const generation = ++this.generation
    try {
      if (!isAbsolute(directory)) throw new CodingAgentError('请选择绝对项目目录')
      const cwd = await realpath(directory).catch(() => '')
      if (!cwd || !(await stat(cwd)).isDirectory())
        throw new CodingAgentError('项目目录不存在或不可访问')
      const path = this.info.executablePath ?? (await this.inspect()).executablePath
      if (!path) throw new CodingAgentError('未发现 Codex 原生 CLI，请选择程序')
      const executable = await inspectCodexExecutable(path)
      this.revertSupported = await inspectCodexRevert(executable.path)
      if (generation !== this.generation) throw new CodingAgentError('Codex 连接已取消')
      const peer = this.launch(
        executable.path,
        cwd,
        (method, params) => {
          if (generation === this.generation) this.notification(method, params)
        },
        (method, params, requestId) =>
          generation === this.generation
            ? this.permission(method, params, requestId)
            : Promise.resolve({ decision: 'decline' }),
        () => {
          if (generation === this.generation) this.disconnected()
        }
      )
      this.peer = peer
      await peer.request('initialize', {
        clientInfo: { name: 'tool_box', title: 'Tool_box', version: '0.3.0' },
        capabilities: { experimentalApi: false, explicitGatewayOauth: true }
      })
      peer.notify('initialized', {})
      const account = codexObject(await peer.request('account/read', { refreshToken: false }))
      const models = await this.readModels(peer)
      if (generation !== this.generation || this.peer !== peer)
        throw new CodingAgentError('Codex 连接已结束')
      this.models = models
      this.info = {
        ...this.info,
        executablePath: executable.path,
        version: executable.version,
        directory: cwd,
        connected: true,
        visibleModelIds: models.map((item) => item.id),
        detail:
          account?.requiresOpenaiAuth === true && !account.account
            ? '尚未登录；请先在 Codex 原生程序完成登录，再重新连接'
            : 'App Server 已连接，使用 Codex 原生认证；Desktop 会话同步尚未确认'
      }
      this.savePreferences()
      console.info('[Codex] App Server 已连接', { version: executable.version })
      this.emit({ kind: 'connection', connected: true })
      return structuredClone(this.info)
    } catch (error) {
      if (generation === this.generation) this.disconnect()
      throw error
    } finally {
      this.connecting = false
    }
  }

  disconnect(): void {
    this.questions.cancel()
    this.questionRequests.clear()
    this.resolvedQuestions.clear()
    ++this.generation
    const peer = this.peer
    if (this.run?.turnId)
      peer?.notify('turn/interrupt', { threadId: this.run.session.id, turnId: this.run.turnId })
    this.peer = null
    peer?.close()
    this.disconnected()
  }

  async listSessions(): Promise<CodingAgentSessionSummary[]> {
    const peer = this.requirePeer()
    const previousTitles = new Map([...this.sessions].map(([id, session]) => [id, session.title]))
    const result = codexObject(
      await peer.request('thread/list', {
        cwd: this.info.directory,
        limit: 100,
        archived: false,
        sourceKinds: ['cli', 'vscode', 'exec', 'appServer']
      })
    )
    this.checkPeer(peer)
    if (!Array.isArray(result?.data)) throw new CodingAgentError('Codex 未返回有效的会话列表')
    return result.data.slice(0, 100).flatMap((raw) => {
      const thread = codexObject(raw)
      const id = codexText(thread?.id)
      if (!thread || !id || thread.parentThreadId || !this.sameDirectory(thread.cwd)) return []
      let title = codexTitle(thread)
      const session = this.sessions.get(id)
      if (session && previousTitles.has(id) && session.title !== previousTitles.get(id))
        title = session.title
      if (session && session.title !== title) {
        session.title = title
        this.publish(session, true)
      }
      return [{ id, title }]
    })
  }

  async openSession(id?: string): Promise<NativeCodingSession> {
    const peer = this.requirePeer()
    if (this.run) throw new CodingAgentError('请先等待或停止当前任务')
    if (this.sessions.size >= 20 && (!id || !this.sessions.has(id)))
      throw new CodingAgentError('当前连接已打开 20 个会话，请重新连接')
    if (id) {
      const read = codexObject(
        await peer.request('thread/read', { threadId: id, includeTurns: false })
      )
      this.checkPeer(peer)
      const thread = codexObject(read?.thread)
      if (!thread || thread.id !== id || thread.parentThreadId || !this.sameDirectory(thread.cwd))
        throw new CodingAgentError('所选 Codex 会话不属于当前项目')
      if (codexObject(thread.status)?.type === 'active')
        throw new CodingAgentError('该原生会话正在执行，请在原入口完成或停止后恢复')
    }
    const result = codexObject(
      await peer.request(id ? 'thread/resume' : 'thread/start', {
        cwd: this.info.directory,
        ...(id
          ? { threadId: id }
          : { sandbox: 'read-only', approvalPolicy: 'on-request', approvalsReviewer: 'user' })
      })
    )
    this.checkPeer(peer)
    const thread = codexObject(result?.thread)
    const nativeId = codexText(thread?.id)
    if (!thread || !nativeId || (id && id !== nativeId) || !this.sameDirectory(thread.cwd))
      throw new CodingAgentError('Codex 未返回有效的项目会话，请重新选择历史记录')
    const sandbox = codexObject(result?.sandbox)
    const permission =
      sandbox?.type === 'readOnly'
        ? 'read-only'
        : sandbox?.type === 'workspaceWrite'
          ? 'workspace-write'
          : null
    const reusablePermission = Boolean(
      permission &&
      result?.approvalPolicy === 'on-request' &&
      (sandbox?.networkAccess === undefined || sandbox.networkAccess === false) &&
      (sandbox?.writableRoots === undefined ||
        (Array.isArray(sandbox.writableRoots) &&
          sandbox.writableRoots.every((root) => this.sameDirectory(root)))) &&
      (result?.approvalsReviewer === undefined || result.approvalsReviewer === 'user')
    )
    if (!id && (!reusablePermission || permission !== 'read-only'))
      throw new CodingAgentError('Codex 未确认新会话的只读权限，请检查原生配置')
    const session: NativeCodingSession = {
      id: nativeId,
      directory: this.info.directory,
      title: codexTitle(thread),
      status: 'ready',
      messages: [],
      tools: [],
      approvals: [],
      subtasks: [],
      options: codexOptions(
        this.models,
        codexText(result?.model),
        codexText(result?.reasoningEffort)
      ),
      error: ''
    }
    session.canRevert = this.revertSupported && thread.historyMode === 'paginated'
    // 历史可读与后续执行分开：无法映射的策略保留原样，下一次发送前由用户明确选权限。
    session.options.find((item) => item.id === 'permission')!.currentValue =
      reusablePermission && permission ? permission : ''
    if (Array.isArray(thread.turns))
      for (const raw of thread.turns.slice(-100)) {
        const turn = codexObject(raw)
        if (turn?.status === 'inProgress')
          throw new CodingAgentError('该会话存在进行中的原生任务，请先在原入口核对')
        if (Array.isArray(turn?.items))
          for (const item of turn.items.slice(-200)) applyCodexItem(session, item)
      }
    const fresh =
      id && thread.historyMode === 'paginated' ? (await this.readHistory(peer, session, true)).session : session
    fresh.canRevert = session.canRevert
    this.checkPeer(peer)
    this.uncertainReverts.delete(nativeId)
    this.sessions.set(nativeId, fresh)
    this.publish(fresh, true)
    return structuredClone(fresh)
  }

  private async readHistory(peer: CodexPeer, session: NativeCodingSession, recent = false) {
    const history = await readCodexHistory(
      peer,
      session,
      (thread) =>
        thread.id === session.id && !thread.parentThreadId && this.sameDirectory(thread.cwd),
      recent
    )
    this.checkPeer(peer)
    return history
  }

  async previewRevert(id: string, messageId: string): Promise<NativeRevertPreview> {
    const session = this.requireSession(id)
    if (this.run || this.uncertainReverts.has(id))
      throw new CodingAgentError('请先结束任务或核对回退结果，再重新预览')
    if (!session.canRevert) throw new CodingAgentError('当前 Codex 会话没有可确认的分页回退能力')
    return codexRevertPreview(
      await this.readHistory(this.requirePeer(), session),
      messageId,
      this.userTurns.get(`${id}:${messageId}`)
    )
  }

  async revert(id: string, preview: NativeRevertPreview): Promise<NativeCodingSession> {
    const peer = this.requirePeer()
    const session = this.requireSession(id)
    if (this.run || this.uncertainReverts.has(id))
      throw new CodingAgentError('请先结束任务或核对回退结果')
    const history = await this.readHistory(peer, session)
    const index = history.turns.findIndex((turn) => turn.id === preview.beforeTurnId)
    if (history.revision !== preview.revision || index < 0)
      throw new CodingAgentError('原生历史已变化，请重新预览回退范围')
    this.uncertainReverts.add(id)
    try {
      await peer.request('thread/revert', { threadId: id, beforeTurnId: preview.beforeTurnId })
      this.checkPeer(peer)
      const fresh = await this.readHistory(peer, session)
      if (
        fresh.turns.length !== index ||
        fresh.turns.some(
          (turn, position) => turn.fingerprint !== history.turns[position].fingerprint
        )
      )
        throw new CodingAgentError('回退后的原生历史与预览不一致')
      // 成功回读前不更改显示；清理旧定时分片后整体替换权威历史。
      const timer = this.updates.get(id)
      if (timer) clearTimeout(timer)
      this.updates.delete(id)
      this.sessions.set(id, fresh.session)
      this.uncertainReverts.delete(id)
      for (const key of this.userTurns.keys())
        if (key.startsWith(`${id}:`)) this.userTurns.delete(key)
      console.info('[Codex] 对话回退已确认', { affectedTurns: preview.affectedTurns })
      return structuredClone(fresh.session)
    } catch {
      // RPC 超时也可能已经生效；凭据已消费，保留旧显示并阻止盲重发，须显式核对历史。
      session.status = 'error'
      session.outcome = 'unknown'
      session.canRevert = false
      session.error = '回退结果尚未确认，请先核对原生历史；不会自动重试或恢复文件'
      this.publish(session, true)
      throw new CodingAgentHistoryUnknownError(session.error)
    }
  }

  async setOption(id: string, optionId: string, value: string): Promise<NativeCodingSession> {
    const session = this.requireSession(id)
    if (this.run) throw new CodingAgentError('请先等待或停止当前任务再调整选项')
    const option = session.options.find((item) => item.id === optionId)
    if (!option?.options.some((item) => item.value === value))
      throw new CodingAgentError('Codex 选项已变化，请重新选择')
    option.currentValue = value
    if (optionId === 'model') {
      const permission = session.options.find((item) => item.id === 'permission')!.currentValue
      session.options = codexOptions(this.models, value)
      session.options.find((item) => item.id === 'permission')!.currentValue = permission
    }
    this.publish(session, true)
    return structuredClone(session)
  }

  async catalog(id?: string): Promise<NativeAgentCatalog> {
    const peer = this.requirePeer()
    if (id) this.requireSession(id)
    const result: NativeAgentCatalog = {
      commands: nativeCommands([{ name: 'compact', description: '原生压缩上下文 · 需要已有对话' }]),
      skills: [],
      mcp: [],
      notices: []
    }
    const [skills, mcp] = await Promise.allSettled([
      peer.request('skills/list', { cwds: [this.info.directory], forceReload: true }, 15_000),
      peer.request('mcpServerStatus/list', { limit: 100, ...(id ? { threadId: id } : {}) }, 15_000)
    ])
    this.checkPeer(peer)
    if (skills.status === 'fulfilled') {
      const data = codexObject(skills.value)?.data
      for (const raw of Array.isArray(data) ? data.slice(0, 10) : []) {
        const group = codexObject(raw)
        if (!this.sameDirectory(group?.cwd)) continue
        for (const value of Array.isArray(group?.skills) ? group.skills.slice(0, 300) : []) {
          const item = codexObject(value)
          const path = codexText(item?.path, 4096)
          const name = codexText(item?.name, 120)
          if (name && isAbsolute(path) && item?.enabled !== false)
            result.skills.push({ name, path, description: codexText(item?.description, 500) })
        }
        if (Array.isArray(group?.errors) && group.errors.length)
          result.notices.push('部分 Skill 无法读取，请在原生程序检查配置')
      }
    } else result.notices.push('当前 Codex 未提供可读取的 Skill 列表，或读取失败')
    if (mcp.status === 'fulfilled') {
      const response = codexObject(mcp.value)
      for (const value of Array.isArray(response?.data) ? response.data.slice(0, 100) : []) {
        const item = codexObject(value)
        const name = codexText(item?.name, 120)
        if (!name) continue
        const entries = codexObject(item?.tools)
        result.mcp.push({
          name,
          status: codexText(item?.authStatus, 40) || '已发现 · 连接状态未知',
          tools: Object.entries(entries ?? {})
            .slice(0, 200)
            .map(([name, raw]) => ({
              name: name.slice(0, 120),
              description: codexText(codexObject(raw)?.description, 500)
            }))
        })
      }
      if (response?.nextCursor)
        result.notices.push('MCP 列表超过首批 100 项，请在原生程序查看其余服务')
    } else result.notices.push('当前 Codex 未提供可读取的 MCP 状态，或读取失败')
    return result
  }

  /** compact 的 RPC 只表示受理，完成仍由原生 turn / contextCompaction 事件结算。 */
  async compact(id: string): Promise<void> {
    const peer = this.requirePeer()
    const session = this.requireSession(id)
    if (this.uncertainReverts.has(id))
      throw new CodingAgentError('回退结果未知，请先核对原生历史再压缩')
    if (this.run) throw new CodingAgentError('Codex 已有正在执行的任务')
    let resolveReady!: (id: string | null) => void
    const ready = new Promise<string | null>((resolve) => {
      resolveReady = resolve
    })
    const run: CodexRun = {
      session,
      turnId: null,
      clientId: randomUUID(),
      compacting: true,
      pending: [],
      ready,
      resolveReady,
      timer: setTimeout(() => this.disconnect(), 10 * 60_000)
    }
    this.run = run
    session.status = 'running'
    session.outcome = null
    session.error = ''
    session.tools = [{ id: run.clientId, title: '压缩上下文', status: 'running' }]
    this.publish(session, true)
    try {
      await peer.request('thread/compact/start', { threadId: id }, 30_000)
      this.checkPeer(peer)
    } catch {
      if (this.run === run) {
        clearTimeout(run.timer)
        run.resolveReady(null)
        this.run = null
        session.status = 'error'
        session.outcome = 'unknown'
        session.error = '原生压缩未能确认，请检查 Codex 版本及原会话；未自动重试'
        this.publish(session, true)
      }
      throw new CodingAgentError('原生压缩未能确认，请核对 Codex 原会话后再操作')
    }
  }

  async send(id: string, content: string, context?: NativeSendContext): Promise<void> {
    const peer = this.requirePeer()
    const session = this.requireSession(id)
    if (this.uncertainReverts.has(id))
      throw new CodingAgentError('回退结果未知，请先核对原生历史再发送')
    if (this.run) throw new CodingAgentError('Codex 已有正在执行的任务')
    if (!content.trim() || content.length > 50_000)
      throw new CodingAgentError('编程任务需在 1 至 50,000 字以内')
    const permission = session.options.find((item) => item.id === 'permission')
    if (!permission || !permission.options.some((item) => item.value === permission.currentValue))
      throw new CodingAgentError('请先选择只读或项目写入权限，再继续对话；原生权限未被改写')
    const clientId = randomUUID()
    codexMessage(session, clientId, 'user', content)
    session.status = 'running'
    session.outcome = null
    session.error = ''
    session.tools = []
    session.subtasks = []
    let resolveReady!: (id: string | null) => void
    const ready = new Promise<string | null>((resolve) => {
      resolveReady = resolve
    })
    const run: CodexRun = {
      session,
      clientId,
      turnId: null,
      timer: setTimeout(() => this.disconnect(), 30 * 60_000),
      pending: [],
      ready,
      resolveReady
    }
    this.run = run
    this.publish(session, true)
    console.info('[Codex] 编程任务开始')
    const option = (key: string): string | undefined =>
      session.options.find((item) => item.id === key)?.currentValue
    try {
      const result = codexObject(
        await peer.request('turn/start', {
          threadId: id,
          clientUserMessageId: clientId,
          input: [
            { type: 'text', text: content },
            ...(context?.skills ?? []).map((skill) => ({
              type: 'skill',
              name: skill.name,
              path: skill.path
            }))
          ],
          cwd: this.info.directory,
          model: option('model'),
          effort: option('effort'),
          approvalPolicy: 'on-request',
          approvalsReviewer: 'user',
          sandboxPolicy:
            option('permission') === 'workspace-write'
              ? {
                  type: 'workspaceWrite',
                  writableRoots: [this.info.directory],
                  networkAccess: false
                }
              : { type: 'readOnly', networkAccess: false }
        })
      )
      this.checkPeer(peer)
      const turn = codexObject(result?.turn)
      const turnId = codexText(turn?.id)
      if (!turnId) {
        this.disconnect()
        throw new CodingAgentError('Codex 任务响应无效，结果未知，请核对原生会话')
      }
      if (this.run === run) {
        run.turnId = turnId
        this.userTurns.set(`${id}:${clientId}`, turnId)
        run.resolveReady(turnId)
        const pending = run.pending.splice(0)
        for (const event of pending) this.notification(event.method, event.params)
        if (turn?.status && turn.status !== 'inProgress') this.finish(run, turn)
      }
    } catch (error) {
      if (this.run === run) this.finish(run, { status: 'failed' })
      throw error
    }
  }

  async stop(id: string): Promise<void> {
    const run = this.run
    if (!run || run.session.id !== id) return
    if (!run.turnId) {
      if (run.compacting) {
        // 压缩 RPC 不返回 turnId；尚未收到事件时只关闭自有连接，结果保持未知。
        this.disconnect()
        return
      }
      throw new CodingAgentError('Codex 正在确认任务，请稍后再停止')
    }
    run.session.status = 'stopping'
    this.clearApprovals(id)
    clearTimeout(run.timer)
    run.timer = setTimeout(() => {
      if (this.run === run) this.disconnect()
    }, 15_000)
    this.publish(run.session, true)
    try {
      await this.requirePeer().request(
        'turn/interrupt',
        { threadId: id, turnId: run.turnId },
        10_000
      )
    } catch (error) {
      this.disconnect()
      throw error
    }
  }

  approve(id: string, approvalId: string, approved: boolean): void {
    const pending = this.approvals.get(approvalId)
    if (!pending || pending.sessionId !== id || this.run?.session.id !== id)
      throw new CodingAgentError('该 Codex 审批已结束或不属于当前运行')
    pending.settle(approved)
  }

  answerQuestion(id: string, answer: AgentQuestionAnswer): void {
    if (this.run?.session.id !== id) throw new CodingAgentError('Codex 问题已结束')
    this.questions.answer(id, answer)
  }

  private async readModels(peer: CodexPeer): Promise<CodexModel[]> {
    const result = await peer.request('model/list', { limit: 200, includeHidden: false })
    return codexModels(result)
  }

  private notification(method: string, raw: unknown): void {
    const params = codexObject(raw)
    if (!params) return
    if (method === 'serverRequest/resolved') {
      if (typeof params.requestId !== 'string' && typeof params.requestId !== 'number') return
      const id = `${typeof params.requestId}:${params.requestId}`
      const local = this.questionRequests.get(id)
      if (local) this.questions.cancelRequest(local)
      else {
        this.resolvedQuestions.add(id)
        if (this.resolvedQuestions.size > 64)
          this.resolvedQuestions.delete(this.resolvedQuestions.values().next().value!)
      }
      return
    }
    const id = codexText(params.threadId)
    const session = this.sessions.get(id)
    if (method === 'thread/name/updated' && session) {
      session.title = codexText(params.threadName, 100).trim() || session.title
      this.publish(session, true)
      return
    }
    const run = this.run
    if (!run || run.session.id !== id) return
    const turn = codexObject(params.turn)
    const turnId = codexText(params.turnId) || codexText(turn?.id)
    if (!turnId) return
    if (
      run.compacting &&
      !run.turnId &&
      (method === 'turn/started' ||
        (method === 'item/started' && codexObject(params.item)?.type === 'contextCompaction'))
    ) {
      run.turnId = turnId
      run.resolveReady(turnId)
    }
    if (!run.turnId) {
      // turn/start 响应之前的事件暂存；只能由响应 ID 认领，不能被上一轮迟到终态抢占。
      if (run.pending.length >= 100) {
        this.disconnect()
        return
      }
      run.pending.push({ method, params })
      return
    }
    if (run.turnId !== turnId) return
    try {
      if (method === 'turn/completed' && turn) this.finish(run, turn)
      else if (method === 'error' && params.willRetry === false)
        this.finish(run, { status: 'failed' })
      else if (method === 'thread/tokenUsage/updated') {
        const usage = codexContextUsage(params.tokenUsage)
        if (usage) {
          run.session.contextUsage = usage
          this.publish(run.session)
        }
      } else if (run.compacting) {
        // 控制操作不向已满的显示缓存追加原生摘要；只等待原生终态。
        return
      } else if (method === 'item/agentMessage/delta') {
        const itemId = codexText(params.itemId)
        if (itemId)
          codexMessage(run.session, itemId, 'assistant', codexText(params.delta, 200_000), true)
        this.publish(run.session)
      } else if (method === 'item/started' || method === 'item/completed') {
        applyCodexItem(run.session, params.item, run.clientId)
        this.publish(run.session)
      }
    } catch {
      // 达到显示限额时断开并标记未知，不能把仍可能执行的原生任务伪装为已停止。
      this.disconnect()
    }
  }

  private async permission(
    method: string,
    raw: unknown,
    requestId?: number | string
  ): Promise<unknown> {
    if (
      method === 'item/tool/requestUserInput' ||
      method === 'tool/requestUserInput' ||
      method === 'mcpServer/elicitation/request'
    ) {
      const elicitation = method === 'mcpServer/elicitation/request'
      const cancelled = elicitation ? { action: 'cancel' } : { answers: {} }
      const params = codexObject(raw)
      const run = this.run
      if (run && !run.turnId) await run.ready
      if (
        !run ||
        this.run !== run ||
        run.session.status !== 'running' ||
        params?.threadId !== run.session.id ||
        (params?.turnId !== run.turnId && !(elicitation && params?.turnId == null)) ||
        (requestId !== undefined && this.resolvedQuestions.has(`${typeof requestId}:${requestId}`))
      )
        return cancelled
      let form: ReturnType<typeof nativeForm> | undefined
      let parsed: ReturnType<typeof nativeQuestions>
      try {
        if (elicitation) {
          if (params?.mode !== 'form') throw new CodingAgentError('此 MCP 表单需在原生客户端处理')
          form = nativeForm(params.requestedSchema, params.message)
          parsed = { questions: form.questions, keys: [] }
        } else parsed = nativeQuestions(params?.questions, 'codex')
      } catch (error) {
        if (!elicitation) throw error
        run.session.tools.push({
          id: randomUUID(),
          title: 'MCP 表单暂不支持或涉及秘密信息，请在原生客户端继续',
          status: 'failed'
        })
        this.publish(run.session, true)
        return { action: 'decline' }
      }
      const pending = this.questions.ask(run.session, {
        kind: 'questions',
        title: elicitation ? 'Codex MCP 需要你回答' : 'Codex 需要你回答',
        ...(form?.message ? { description: form.message } : {}),
        questions: parsed.questions
      })
      const local = run.session.questions?.at(-1)?.id
      const key = requestId === undefined ? undefined : `${typeof requestId}:${requestId}`
      if (key !== undefined && local) this.questionRequests.set(key, local)
      try {
        const answer = await pending
        if (answer.cancelled || this.run !== run) return cancelled
        if (form) return { action: 'accept', content: form.content(answer) }
        return {
          answers: Object.fromEntries(
            parsed.keys.map((key, index) => [
              key,
              {
                answers: answer.answers.find((item) => item.questionId === `q${index}`)!.values
              }
            ])
          )
        }
      } finally {
        if (key !== undefined) this.questionRequests.delete(key)
      }
    }
    if (
      method !== 'item/commandExecution/requestApproval' &&
      method !== 'item/fileChange/requestApproval'
    )
      throw new CodingAgentError('当前 Codex 客户端尚不支持此类交互请求')
    const params = codexObject(raw)
    const run = this.run
    if (run && !run.turnId) await run.ready
    const child = run?.session.subtasks?.some((item) => item.id === params?.threadId)
    if (
      !run ||
      this.run !== run ||
      run.session.status !== 'running' ||
      (!child && params?.threadId !== run.session.id) ||
      (!child && run.turnId && params?.turnId !== run.turnId) ||
      !codexText(params?.turnId) ||
      this.approvals.size >= 20
    )
      return Promise.resolve({ decision: 'decline' })
    const id = randomUUID()
    return new Promise((resolve) => {
      const timer = setTimeout(() => settle(false), 5 * 60_000)
      const settle = (allow: boolean): void => {
        if (!this.approvals.delete(id)) return
        clearTimeout(timer)
        run.session.approvals = run.session.approvals.filter((item) => item.id !== id)
        resolve({ decision: allow ? 'accept' : 'decline' })
        this.publish(run.session, true)
      }
      this.approvals.set(id, { sessionId: run.session.id, settle })
      run.session.approvals.push({
        id,
        title: `Codex${child ? ' 原生子代理' : ''} 请求${method.includes('commandExecution') ? '执行命令' : '修改文件'}`,
        details:
          [
            codexPreview(params?.command),
            codexPreview(params?.reason),
            codexPreview(params?.cwd),
            codexPreview(params?.grantRoot)
          ]
            .filter(Boolean)
            .join('\n') || '请核对本次原生操作，仅允许这一次。',
        canAllow: true
      })
      this.publish(run.session, true)
    })
  }

  private finish(run: CodexRun, turn: Record<string, unknown>): void {
    if (this.run !== run) return
    if (!run.compacting && Array.isArray(turn.items))
      for (const item of turn.items.slice(-200)) applyCodexItem(run.session, item, run.clientId)
    clearTimeout(run.timer)
    run.resolveReady(null)
    this.clearApprovals(run.session.id)
    this.run = null
    const failed = turn.status === 'failed'
    const interrupted = turn.status === 'interrupted'
    const known = failed || interrupted || turn.status === 'completed'
    if (run.compacting) {
      run.session.tools = [
        {
          id: run.clientId,
          title: '压缩上下文',
          status: known && !failed && !interrupted ? 'completed' : 'failed'
        }
      ]
    }
    run.session.status = known && !failed ? 'ready' : 'error'
    run.session.outcome = failed
      ? 'failed'
      : interrupted
        ? 'stopped'
        : known
          ? 'completed'
          : 'unknown'
    run.session.error = failed
      ? 'Codex 任务失败，请检查原生登录、模型额度和项目权限后再决定是否重试'
      : known
        ? ''
        : 'Codex 返回了未知任务状态，请核对原生会话'
    if (run.session.outcome !== 'completed')
      for (const child of run.session.subtasks ?? [])
        if (!['completed', 'errored', 'shutdown', 'interrupted'].includes(child.status))
          child.status = 'unknown'
    console.info('[Codex] 编程任务已结算', { outcome: run.session.outcome })
    this.publish(run.session, true)
    const peer = this.peer
    // 原生名称可能由首条消息预览生成；辅助读取失败不改变已经确认的任务结果。
    void this.listSessions().catch(() => {
      if (peer === this.peer) console.warn('[Codex] 会话名称同步未完成，可手动读取历史重试')
    })
  }

  private disconnected(): void {
    this.userTurns.clear()
    this.uncertainReverts.clear()
    this.questions.cancel()
    this.questionRequests.clear()
    this.resolvedQuestions.clear()
    this.peer = null
    if (this.run) {
      clearTimeout(this.run.timer)
      this.run.resolveReady(null)
    }
    this.run = null
    for (const id of [...this.approvals.keys()]) this.approvals.get(id)?.settle(false)
    for (const timer of this.updates.values()) clearTimeout(timer)
    this.updates.clear()
    this.sessions.clear()
    this.info.connected = false
    this.emit({ kind: 'connection', connected: false })
  }

  private clearApprovals(id: string): void {
    this.questions.cancel(id)
    for (const pending of [...this.approvals.values()])
      if (pending.sessionId === id) pending.settle(false)
  }

  private requirePeer(): CodexPeer {
    if (!this.peer || !this.info.connected) throw new CodingAgentError('请先连接 Codex')
    return this.peer
  }

  private requireSession(id: string): NativeCodingSession {
    this.requirePeer()
    const session = this.sessions.get(id)
    if (!session) throw new CodingAgentError('Codex 会话已失效，请重新选择历史会话')
    return session
  }

  private checkPeer(peer: CodexPeer): void {
    if (peer !== this.peer) throw new CodingAgentError('Codex 连接已结束，不会自动重试')
  }

  private sameDirectory(value: unknown): boolean {
    const path = codexText(value, 4096)
    return (
      !!path &&
      (process.platform === 'win32'
        ? normalize(path).toLowerCase() === normalize(this.info.directory).toLowerCase()
        : normalize(path) === normalize(this.info.directory))
    )
  }

  private savePreferences(): void {
    this.store.configSet({
      codex: {
        ...codexObject(this.store.configGet()?.codex),
        executablePath: this.info.executablePath,
        ...(this.info.connected ? { directory: this.info.directory } : {})
      }
    })
  }

  private publish(session: NativeCodingSession, immediate = false): void {
    const existing = this.updates.get(session.id)
    if (immediate) {
      if (existing) clearTimeout(existing)
      this.updates.delete(session.id)
      this.emit({ kind: 'session', session: structuredClone(session) })
    } else if (!existing)
      this.updates.set(
        session.id,
        setTimeout(() => {
          this.updates.delete(session.id)
          this.emit({ kind: 'session', session: structuredClone(session) })
        }, 50)
      )
  }

  private emit(event: NativeCodingEvent): void {
    for (const listener of this.listeners) listener(event)
  }
}
