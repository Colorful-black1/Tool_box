import { OpenCodeError } from './opencode-error'
import { randomUUID } from 'node:crypto'
import { realpath, stat } from 'node:fs/promises'
import { isAbsolute, normalize } from 'node:path'
import type {
  OpenCodeEvent,
  OpenCodeInfo,
  OpenCodeSession,
  OpenCodeSessionSummary
} from '../../../shared/types'
import type { ToolboxStore } from '../chat-store/chat-store'
import { acpObject } from './acp-connection'
import { acpOptions, acpPreview, acpText, applyAcpUpdate } from './acp-codec'
import { readOpenCodeVisibleModels } from './opencode-models'
import {
  detectOpenCodeExecutable,
  inspectOpenCodeExecutable,
  launchOpenCode
} from './opencode-runtime'

/** 便于用合成传输测试业务状态，生产实现是自有 ACP 子进程。 */
export interface AcpPeer {
  request(method: string, params: unknown, timeoutMs?: number): Promise<unknown>
  notify(method: string, params: unknown): void
  close(): void
}

export type OpenCodeLauncher = (...args: Parameters<typeof launchOpenCode>) => AcpPeer

/** 独立管理外部编程会话，不向 OpenCode 提供百宝箱内部工具或数据库。 */
export class OpenCodeService {
  private peer: AcpPeer | null = null
  private generation = 0
  private connecting = false
  private readonly sessions = new Map<string, OpenCodeSession>()
  private readonly sessionTitles = new Map<string, string>()
  private titleRefreshTimer: NodeJS.Timeout | null = null
  private readonly listeners = new Set<(event: OpenCodeEvent) => void>()
  private readonly updates = new Map<string, NodeJS.Timeout>()
  private readonly stopTimers = new Map<string, NodeJS.Timeout>()
  private readonly approvals = new Map<
    string,
    { sessionId: string; settle(allow: boolean): void }
  >()
  private info: OpenCodeInfo = {
    executablePath: null,
    version: null,
    directory: '',
    connected: false,
    canLoadSession: false,
    visibleModelIds: []
  }

  constructor(
    private readonly store: Pick<ToolboxStore, 'configGet' | 'configSet'>,
    private readonly launch: OpenCodeLauncher = launchOpenCode,
    private readonly readVisibleModels = readOpenCodeVisibleModels
  ) {}

  subscribe(listener: (event: OpenCodeEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async inspect(): Promise<OpenCodeInfo> {
    const preferences = acpObject(this.store.configGet()?.opencode)
    if (!this.info.connected) {
      this.info.executablePath = await detectOpenCodeExecutable(
        acpText(preferences?.executablePath, 4096)
      )
      this.info.directory = acpText(preferences?.directory, 4096)
    } else if (this.info.executablePath) {
      const peer = this.peer
      const visibleModelIds = await this.readVisibleModels(
        this.info.executablePath,
        this.info.directory
      )
      if (peer !== this.peer) throw new OpenCodeError('连接已结束，请重新连接后同步模型')
      this.info.visibleModelIds = visibleModelIds
    }
    return { ...this.info }
  }

  async selectExecutable(path: string): Promise<OpenCodeInfo> {
    if (this.peer || this.connecting) throw new OpenCodeError('请先断开 OpenCode 再更换程序')
    const executable = await inspectOpenCodeExecutable(path)
    this.info = { ...this.info, executablePath: executable.path, version: executable.version }
    this.savePreferences()
    return { ...this.info }
  }

  async connect(directory: string): Promise<OpenCodeInfo> {
    if (this.connecting) throw new OpenCodeError('OpenCode 正在连接，请稍候')
    if (this.hasRunning()) throw new OpenCodeError('请先停止任务再更换连接')
    this.disconnect()
    this.connecting = true
    const generation = ++this.generation
    try {
      if (!isAbsolute(directory)) throw new OpenCodeError('请选择绝对项目目录')
      const cwd = await realpath(directory).catch(() => '')
      if (!cwd || !(await stat(cwd)).isDirectory())
        throw new OpenCodeError('项目目录不存在或不可访问')
      const path = this.info.executablePath ?? (await this.inspect()).executablePath
      if (!path) throw new OpenCodeError('未发现 OpenCode Desktop 内置 CLI，请选择程序')
      const executable = await inspectOpenCodeExecutable(path)
      if (generation !== this.generation) throw new OpenCodeError('连接已取消')
      const peer = this.launch(
        executable.path,
        cwd,
        (method, params) => {
          if (generation === this.generation) this.notification(method, params)
        },
        (method, params) =>
          generation === this.generation
            ? this.permission(method, params)
            : Promise.resolve({ outcome: { outcome: 'cancelled' } }),
        () => {
          if (generation === this.generation) this.disconnected()
        }
      )
      this.peer = peer
      const handshake = acpObject(
        await peer.request('initialize', {
          protocolVersion: 1,
          clientCapabilities: {},
          clientInfo: { name: 'tool-box', version: '0.3.0' }
        })
      )
      if (generation !== this.generation || this.peer !== peer)
        throw new OpenCodeError('连接已结束')
      if (handshake?.protocolVersion !== 1 || acpObject(handshake.agentInfo)?.name !== 'OpenCode')
        throw new OpenCodeError('当前程序不支持所需的 OpenCode ACP 协议')
      const visibleModelIds = await this.readVisibleModels(executable.path, cwd)
      if (generation !== this.generation || this.peer !== peer)
        throw new OpenCodeError('连接已结束')
      this.info = {
        executablePath: executable.path,
        directory: cwd,
        version: executable.version,
        connected: true,
        canLoadSession: acpObject(handshake.agentCapabilities)?.loadSession === true,
        visibleModelIds
      }
      this.savePreferences()
      console.info('[OpenCode] ACP 已连接', { version: executable.version })
      this.emit({ kind: 'connection', connected: true })
      return { ...this.info }
    } catch (error) {
      if (generation === this.generation) this.disconnect()
      throw error
    } finally {
      this.connecting = false
    }
  }

  disconnect(): void {
    ++this.generation
    const peer = this.peer
    for (const session of this.sessions.values()) {
      if (session.status === 'running' || session.status === 'stopping')
        peer?.notify('session/cancel', { sessionId: session.id })
    }
    this.peer = null
    peer?.close()
    this.disconnected()
  }

  async listSessions(): Promise<OpenCodeSessionSummary[]> {
    const peer = this.requirePeer()
    const directory = this.info.directory
    const previousTitles = new Map<string, string>(
      [...this.sessions].map(([id, session]) => [id, session.title])
    )
    const result = acpObject(await peer.request('session/list', { cwd: directory }, 5000))
    if (peer !== this.peer) throw new OpenCodeError('连接已结束，请重新读取历史会话')
    if (!Array.isArray(result?.sessions)) return []
    this.sessionTitles.clear()
    return result.sessions.slice(0, 100).flatMap((raw) => {
      const item = acpObject(raw)
      const id = acpText(item?.sessionId, 200)
      const cwd = acpText(item?.cwd, 4096)
      const same =
        process.platform === 'win32'
          ? normalize(cwd).toLowerCase() === normalize(directory).toLowerCase()
          : normalize(cwd) === normalize(directory)
      if (!id || !cwd || !same) return []
      let title = acpText(item?.title, 100).trim()
      const session = this.sessions.get(id)
      // 查询期间若收到更新的标题推送，不用较早的目录快照覆盖它。
      if (session && previousTitles.has(id) && session.title !== previousTitles.get(id))
        title = session.title
      if (title) {
        this.sessionTitles.set(id, title)
        if (session && session.title !== title) {
          session.title = title
          this.publish(session, true)
        }
      }
      return [{ id, title: title || 'OpenCode 会话' }]
    })
  }

  async openSession(id?: string): Promise<OpenCodeSession> {
    const peer = this.requirePeer()
    if (this.hasRunning()) throw new OpenCodeError('请先停止当前任务再打开会话')
    if (id && !this.info.canLoadSession) throw new OpenCodeError('当前 OpenCode 不支持恢复会话')
    if (this.sessions.size >= 20) throw new OpenCodeError('当前连接已打开 20 个会话，请重新连接')
    if (id && this.sessions.has(id)) {
      await this.refreshSessionTitles(peer)
      if (peer !== this.peer) throw new OpenCodeError('连接已结束')
      return this.sessions.get(id)!
    }
    const session: OpenCodeSession = {
      id: id ?? '',
      title: (id && this.sessionTitles.get(id)) || '新编程会话',
      directory: this.info.directory,
      status: 'ready',
      messages: [],
      tools: [],
      options: [],
      approvals: [],
      error: ''
    }
    if (id) this.sessions.set(id, session)
    try {
      const result = acpObject(
        await peer.request(
          id ? 'session/load' : 'session/new',
          { ...(id ? { sessionId: id } : {}), cwd: this.info.directory, mcpServers: [] },
          30_000
        )
      )
      if (peer !== this.peer) throw new OpenCodeError('连接已结束')
      const sessionId = id ?? acpText(result?.sessionId, 200)
      if (!sessionId) throw new OpenCodeError('OpenCode 未返回有效会话')
      session.id = sessionId
      session.options = acpOptions(result?.configOptions)
      this.sessions.set(sessionId, session)
      // 新会话以 Plan 开始；恢复会话保留原生模式，避免悄悄改变用户已选的权限。
      const mode = session.options.find((option) => option.category === 'mode')
      if (!id && !mode?.options.some((option) => option.value === 'plan'))
        throw new OpenCodeError('当前 OpenCode 未提供可确认的 Plan 模式，请更新桌面版后重试')
      if (!id && mode && mode.currentValue !== 'plan')
        await this.setOption(session.id, mode.id, 'plan')
      await this.refreshSessionTitles(peer)
      if (peer !== this.peer) throw new OpenCodeError('连接已结束')
      this.publish(session, true)
      return session
    } catch (error) {
      if (this.sessions.get(session.id) === session) this.sessions.delete(session.id)
      throw error
    }
  }

  async setOption(id: string, optionId: string, value: string): Promise<OpenCodeSession> {
    const session = this.requireSession(id)
    if (session.status === 'running' || session.status === 'stopping')
      throw new OpenCodeError('任务运行中不能更换模型或模式')
    const option = session.options.find((item) => item.id === optionId)
    if (!option?.options.some((item) => item.value === value))
      throw new OpenCodeError('请选择 OpenCode 提供的配置项')
    if (option.category === 'model' && !this.info.visibleModelIds.includes(value))
      throw new OpenCodeError('请先在 OpenCode Desktop 启用该模型并同步后再选择')
    const result = acpObject(
      await this.requirePeer().request('session/set_config_option', {
        sessionId: id,
        configId: optionId,
        value
      })
    )
    if (Array.isArray(result?.configOptions)) session.options = acpOptions(result.configOptions)
    else option.currentValue = value
    this.publish(session, true)
    return session
  }

  send(id: string, text: string): void {
    const session = this.requireSession(id)
    const peer = this.requirePeer()
    const model = session.options.find((option) => option.category === 'model')
    if (model && !this.info.visibleModelIds.includes(model.currentValue))
      throw new OpenCodeError('当前会话模型未在 Desktop 启用，请先选择已启用模型')
    if (session.status !== 'ready' && session.status !== 'error')
      throw new OpenCodeError('该会话暂时不能发送，请等待或重新连接')
    if (this.hasRunning()) throw new OpenCodeError('首版一次运行一个编程任务，请等待当前任务结束')
    if (session.messages.length >= 198) throw new OpenCodeError('会话消息较多，请新建会话')
    if (
      session.messages.reduce((sum, message) => sum + message.content.length, 0) + text.length >
      180_000
    )
      throw new OpenCodeError('会话内容较多，请新建会话')
    session.messages.push({ id: randomUUID(), role: 'user', content: text })
    session.title = session.title === '新编程会话' ? text.slice(0, 32) : session.title
    session.status = 'running'
    session.error = ''
    session.tools = []
    this.publish(session, true)
    const traceId = randomUUID()
    console.info('[OpenCode] 编程任务开始', { traceId })
    void peer
      .request('session/prompt', { sessionId: id, prompt: [{ type: 'text', text }] }, 15 * 60_000)
      .then(() => {
        if (peer === this.peer && session.status !== 'disconnected')
          session.status = session.error ? 'error' : 'ready'
        console.info('[OpenCode] 编程任务已结算', { traceId })
      })
      .catch((error: unknown) => {
        if (peer !== this.peer) return
        if (session.status === 'stopping') {
          session.status = session.error ? 'error' : 'ready'
          console.info('[OpenCode] 编程任务已停止', { traceId })
          return
        }
        console.warn('[OpenCode] 编程任务失败', { traceId })
        session.status = 'error'
        session.error =
          error instanceof OpenCodeError ? error.message : 'OpenCode 任务失败，请检查模型与登录配置'
      })
      .finally(() => {
        if (peer !== this.peer) return
        this.clearApprovals(id)
        const timer = this.stopTimers.get(id)
        if (timer) clearTimeout(timer)
        this.stopTimers.delete(id)
        this.publish(session, true)
        this.scheduleTitleRefresh(peer)
      })
  }

  stop(id: string): void {
    const session = this.requireSession(id)
    if (session.status !== 'running') return
    session.status = 'stopping'
    this.clearApprovals(id)
    this.requirePeer().notify('session/cancel', { sessionId: id })
    this.stopTimers.set(
      id,
      setTimeout(() => {
        if (session.status === 'stopping') this.disconnect()
      }, 15_000)
    )
    this.publish(session, true)
  }

  approve(id: string, approvalId: string, allow: boolean): void {
    this.requireSession(id)
    const pending = this.approvals.get(approvalId)
    if (!pending || pending.sessionId !== id)
      throw new OpenCodeError('该审批已结束或不属于当前会话')
    pending.settle(allow)
  }

  /** OpenCode 部分版本不推送名称；读取失败只保留现有名称，不影响会话或任务结果。 */
  private async refreshSessionTitles(peer: AcpPeer): Promise<void> {
    if (peer !== this.peer) return
    try {
      await this.listSessions()
    } catch {
      // 名称是辅助元数据，失败不回显第三方错误，也不把成功的编程任务标记为失败。
      if (peer === this.peer) console.warn('[OpenCode] 会话名称同步未完成，可重新读取历史重试')
    }
  }

  private scheduleTitleRefresh(peer: AcpPeer): void {
    if (peer !== this.peer) return
    void this.refreshSessionTitles(peer)
    if (this.titleRefreshTimer) clearTimeout(this.titleRefreshTimer)
    // 原生自动命名可能晚于任务结算；只补一次延迟读取，不持续轮询。
    this.titleRefreshTimer = setTimeout(() => {
      this.titleRefreshTimer = null
      void this.refreshSessionTitles(peer)
    }, 10_000)
  }

  private notification(method: string, params: unknown): void {
    if (method !== 'session/update') return
    const body = acpObject(params)
    const session = this.sessions.get(acpText(body?.sessionId, 200))
    if (
      !session ||
      session.status === 'disconnected' ||
      session.status === 'error' ||
      session.error
    )
      return
    try {
      applyAcpUpdate(session, body?.update)
    } catch {
      session.error = '会话显示达到上限，已请求停止，请新建会话'
      this.stop(session.id)
    }
    this.publish(session)
  }

  private permission(method: string, params: unknown): Promise<unknown> {
    if (method !== 'session/request_permission')
      return Promise.reject(new OpenCodeError('不支持此客户端能力'))
    const body = acpObject(params)
    const session = this.sessions.get(acpText(body?.sessionId, 200))
    if (!session || session.status !== 'running' || this.approvals.size >= 20)
      return Promise.resolve({ outcome: { outcome: 'cancelled' } })
    const options = Array.isArray(body?.options) ? body.options.slice(0, 20).map(acpObject) : []
    const allow = options.find((option) => option?.kind === 'allow_once')
    const reject = options.find((option) => option?.kind === 'reject_once')
    const tool = acpObject(body?.toolCall)
    const id = randomUUID()
    return new Promise((resolve) => {
      const timer = setTimeout(() => settle(false), 120_000)
      const settle = (approved: boolean): void => {
        if (!this.approvals.delete(id)) return
        clearTimeout(timer)
        session.approvals = session.approvals.filter((item) => item.id !== id)
        const optionId = acpText((approved ? allow : reject)?.optionId, 200)
        resolve({
          outcome: optionId ? { outcome: 'selected', optionId } : { outcome: 'cancelled' }
        })
        this.publish(session, true)
      }
      this.approvals.set(id, { sessionId: session.id, settle })
      session.approvals.push({
        id,
        title: acpPreview(tool?.title ?? 'OpenCode 请求执行操作'),
        details: acpPreview(tool?.rawInput ?? tool?.content ?? {}),
        canAllow: Boolean(acpText(allow?.optionId, 200))
      })
      this.publish(session, true)
    })
  }

  private clearApprovals(id: string): void {
    for (const pending of [...this.approvals.values()])
      if (pending.sessionId === id) pending.settle(false)
  }

  private disconnected(): void {
    if (this.info.connected) console.info('[OpenCode] ACP 连接已结束')
    this.peer = null
    this.info.connected = false
    if (this.titleRefreshTimer) clearTimeout(this.titleRefreshTimer)
    this.titleRefreshTimer = null
    this.sessionTitles.clear()
    for (const timer of this.stopTimers.values()) clearTimeout(timer)
    this.stopTimers.clear()
    for (const timer of this.updates.values()) clearTimeout(timer)
    this.updates.clear()
    for (const session of this.sessions.values()) {
      this.clearApprovals(session.id)
      if (session.status === 'running' || session.status === 'stopping')
        session.error = '连接已中断，任务结果未知，未自动重发；请检查 OpenCode 后再操作'
      session.status = 'disconnected'
      this.publish(session, true)
    }
    this.sessions.clear()
    this.emit({ kind: 'connection', connected: false })
  }

  private requirePeer(): AcpPeer {
    if (!this.peer || !this.info.connected) throw new OpenCodeError('请先连接 OpenCode')
    return this.peer
  }

  private requireSession(id: string): OpenCodeSession {
    this.requirePeer()
    const session = this.sessions.get(id)
    if (!session) throw new OpenCodeError('会话已失效，请重新打开')
    return session
  }

  private hasRunning(): boolean {
    return [...this.sessions.values()].some(
      (session) => session.status === 'running' || session.status === 'stopping'
    )
  }

  private savePreferences(): void {
    this.store.configSet({
      opencode: { executablePath: this.info.executablePath, directory: this.info.directory }
    })
  }

  private publish(session: OpenCodeSession, immediate = false): void {
    const previous = this.updates.get(session.id)
    if (immediate && previous) {
      clearTimeout(previous)
      this.updates.delete(session.id)
    }
    if (!immediate && previous) return
    if (immediate) this.emit({ kind: 'session', session })
    else
      this.updates.set(
        session.id,
        setTimeout(() => {
          this.updates.delete(session.id)
          this.emit({ kind: 'session', session })
        }, 50)
      )
  }

  private emit(event: OpenCodeEvent): void {
    for (const listener of this.listeners) listener(event)
  }
}
