import { randomUUID } from 'node:crypto'
import { lstat, realpath, stat } from 'node:fs/promises'
import { normalize } from 'node:path'
import type {
  AgentCatalog,
  AgentCommandInput,
  AgentReference,
  AgentSendInput
} from '../../../shared/agent-actions'
import { AgentProjectFiles, withinProject } from './agent-project-files'
import type { AgentProjectMemory } from './agent-project-memory'
import type { AgentQuestionAnswer } from '../../../shared/agent-session'
import { nativeCommands, unavailableCatalog } from './agent-action-catalog'
import {
  CODING_AGENT_IDS,
  CODING_AGENT_NAMES,
  type CodingAgentEvent,
  type CodingAgentId,
  type CodingAgentRuntimeView,
  type CodingAgentSessionView,
  type CodingAgentWorkspaceResult
} from '../../../shared/coding-agents'
import type { CodingAgentRevertPreview } from '../../../shared/coding-agents'
import type { NativeRevertPreview } from './adapter'
import { IPC } from '../../../shared/ipc-contract'
import { OpenCodeError } from '../opencode/opencode-error'
import {
  CodingAgentError,
  CodingAgentHistoryUnknownError,
  type CodingAgentAdapter,
  type NativeCodingEvent,
  type NativeCodingSession,
  type NativeSendContext
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
  directory: string
  startedAt: number
  targetFile?: string
}

/** 原生适配边界：路由、所有权、互斥与事件身份在此收敛，不持久化正文。 */
export class CodingAgentService {
  private readonly runtimes = new Map<CodingAgentId, RuntimeState>()
  private readonly listeners = new Set<(owner: number, event: CodingAgentEvent) => void>()
  private readonly active = new Map<CodingAgentId, ActiveRun>()
  private readonly historyLocks = new Set<string>()
  private readonly revertPreviews = new Map<
    string,
    {
      owner: number
      runtimeId: CodingAgentId
      connectionId: string
      sessionRef: string
      runId: string | null
      expiresAt: number
      preview: NativeRevertPreview
    }
  >()
  private readonly files = new AgentProjectFiles()
  private readonly selectedDirectories = new Map<number, Map<string, string>>()
  private readonly catalogs = new Map<
    string,
    {
      view: AgentCatalog
      bindings: Map<string, { kind: 'command' | 'skill' | 'tool'; name: string; path?: string }>
    }
  >()

  constructor(
    adapters: CodingAgentAdapter[],
    private readonly projects?: AgentProjectMemory
  ) {
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
    const info = await state.adapter.inspect()
    return this.updateInfo(state, {
      ...info,
      ...(this.projects ? await this.projects.inspect(id) : {})
    })
  }

  /** 明确选择项目只更新偏好和目录授权，绝不替换当前原生连接。 */
  selectProject(id: CodingAgentId, owner: number, directory: string): Promise<string> {
    const state = this.requireRuntime(id)
    return this.operate(state, owner, true, async () => {
      if (!this.projects) throw new CodingAgentError('当前版本未提供项目记忆，请重启更新后的应用')
      const path = await this.projects.select(id, directory)
      await this.allowDirectory(owner, path)
      state.info = { ...state.info, projectDirectory: path, projectError: undefined }
      this.publishRuntime(state)
      return path
    })
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
        const info = await state.adapter.connect(directory)
        const projectDirectory = this.projects
          ? await this.projects.select(id, info.directory)
          : undefined
        return this.updateInfo(state, {
          ...info,
          ...(projectDirectory ? { projectDirectory, projectError: undefined } : {})
        })
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

  /** 只把已打开会话归入 DSH Desktop 工作区；不创建、不恢复、不发送。 */
  async attachWorkspace(
    id: CodingAgentId,
    owner: number,
    ref: string
  ): Promise<CodingAgentWorkspaceResult> {
    const state = this.connected(id, owner)
    const session = this.session(state, ref)
    if (!state.adapter.attachWorkspace)
      throw new CodingAgentError('当前 Agent 不支持 DSH 工作区归组')
    return state.adapter.attachWorkspace(session.nativeSessionId, session.directory)
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
      // 明确的历史重读可以更新正文；普通运行事件仍走终态后的迟到事件拦截。
      const view = this.upsert(state, session, Boolean(nativeId))
      const initial = this.catalogs.get(this.catalogKey(state))
      if (!nativeId && initial)
        this.catalogs.set(this.catalogKey(state, view.id), {
          bindings: new Map(initial.bindings),
          view: { ...structuredClone(initial.view), sessionId: view.id }
        })
      return view
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

  async send(
    id: CodingAgentId,
    owner: number,
    ref: string,
    content: string,
    extra: Pick<AgentSendInput, 'references' | 'literal'> = {}
  ): Promise<void> {
    const command = /^\/([\w:.-]+)(?:\s|$)/.exec(content)
    if (command && !extra.literal) {
      const catalog = await this.readCatalog(id, owner, ref)
      const action = catalog.commands.find((item) => item.name === command[1])
      if (!action) throw new CodingAgentError('未识别为可用命令；可明确选择“作为普通文字发送”')
      return this.executeCommand(
        owner,
        {
          runtimeId: id,
          sessionId: ref,
          commandId: action.id,
          arguments: content.slice(command[0].length).trim()
        },
        extra.references,
        false
      )
    }
    const state = this.connected(id, owner)
    return this.operate(state, owner, true, async () => {
      const session = this.session(state, ref)
      if (session.status !== 'ready' && session.status !== 'error')
        throw new CodingAgentError('该会话暂时不能发送，请等待或重新选择历史会话')
      const { context, additions } = await this.resolveReferences(
        state,
        owner,
        session,
        extra.references
      )
      const text = `${extra.literal && content.startsWith('/') ? '以下内容作为普通文本处理：\n' : ''}${content}${additions.length ? `\n\n${additions.join('\n')}` : ''}`
      if (text.length > 50_000) throw new CodingAgentError('正文及引用超过 50,000 字符，请缩短任务')
      this.begin(state, session)
      try {
        await state.adapter.send(session.nativeSessionId, text, context)
      } catch (error) {
        if (this.active.get(id)?.runId === session.runId) {
          this.finishTiming(session, this.active.get(id))
          this.active.delete(id)
          session.status = state.info.connected ? 'error' : 'disconnected'
          session.outcome = state.info.connected ? 'failed' : 'unknown'
          session.error = this.errorText(error)
          this.publishSession(state, session)
        }
        throw error
      }
    })
  }

  /** 目录由用户选择或既有连接确认；文件 IPC 不扩大到任意磁盘位置。 */
  async allowDirectory(owner: number, directory: string): Promise<void> {
    const actual = await realpath(directory).catch(() => '')
    if (!actual) throw new CodingAgentError('所选项目目录已不可访问')
    const entries = this.selectedDirectories.get(owner) ?? new Map<string, string>()
    if (entries.size >= 100) entries.delete(entries.keys().next().value!)
    entries.set(this.directoryKey(directory), this.directoryKey(actual))
    this.selectedDirectories.set(owner, entries)
  }

  private directoryKey(directory: string): string {
    const path = normalize(directory)
    return process.platform === 'win32' ? path.toLowerCase() : path
  }

  async searchFiles(id: CodingAgentId, owner: number, directory: string, query: string) {
    const state = this.requireRuntime(id)
    this.requireOwner(state, owner)
    const key = this.directoryKey(directory)
    const actual = await realpath(directory).catch(() => '')
    const actualKey = actual ? this.directoryKey(actual) : ''
    if (
      !actualKey ||
      (actualKey !== this.directoryKey(state.info.directory) &&
        this.selectedDirectories.get(owner)?.get(key) !== actualKey)
    )
      throw new CodingAgentError('请先通过项目选择器选择此目录')
    return this.files.search(`${owner}:${id}`, actual, query)
  }

  private catalogKey(state: RuntimeState, ref = ''): string {
    return `${state.adapter.id}:${state.info.connectionId}:${ref}`
  }

  private async resolveReferences(
    state: RuntimeState,
    owner: number,
    session: CodingAgentSessionView,
    references: AgentReference[] = []
  ): Promise<{ context: NativeSendContext; additions: string[] }> {
    const connection = state.info.connectionId
    const context: NativeSendContext = { files: [], skills: [] }
    const additions: string[] = []
    const catalog = this.catalogs.get(this.catalogKey(state, session.id))
    for (const item of references) {
      if (item.kind === 'file') {
        const path = await this.files.resolve(
          `${owner}:${state.adapter.id}`,
          session.directory,
          item
        )
        context.files!.push(path)
        additions.push(`文件路径：${JSON.stringify(path)}`)
      } else {
        const binding = catalog?.bindings.get(item.id)
        if (!binding || binding.kind !== item.kind)
          throw new CodingAgentError('扩展引用已失效，请重新选择；草稿已保留')
        if (item.kind === 'skill') {
          if (state.adapter.id !== 'codex')
            throw new CodingAgentError('此 Skill 请通过原生命令调用')
          context.skills!.push({ name: binding.name, path: binding.path! })
          additions.push(`$${binding.name}`)
        } else
          additions.push(
            `请优先使用已配置的 MCP 工具 ${JSON.stringify(binding.name)} 完成任务；实际调用仍遵守原生权限。`
          )
      }
    }
    if (connection !== state.info.connectionId || !state.info.connected)
      throw new CodingAgentError('连接已变化，草稿已保留')
    return { context, additions }
  }

  async readCatalog(id: CodingAgentId, owner: number, ref?: string): Promise<AgentCatalog> {
    const state = this.connected(id, owner)
    return this.operate(state, owner, false, async () => {
      const session = ref ? this.session(state, ref) : undefined
      const connection = state.info.connectionId
      if (session?.status === 'running' || session?.status === 'stopping') {
        const cached = this.catalogs.get(this.catalogKey(state, ref))
        if (cached) return structuredClone(cached.view)
        throw new CodingAgentError('请在当前任务结束后读取能力')
      }
      const native = state.adapter.catalog
        ? await state.adapter.catalog(session?.nativeSessionId)
        : unavailableCatalog('当前接入未提供命令、Skill 或 MCP 状态查询')
      if (connection !== state.info.connectionId || !state.info.connected)
        throw new CodingAgentError('连接已变化，请重新读取能力')
      const key = this.catalogKey(state, ref)
      const previous = this.catalogs.get(key)
      const bindings = new Map<
        string,
        { kind: 'command' | 'skill' | 'tool'; name: string; path?: string }
      >()
      const bind = (kind: 'command' | 'skill' | 'tool', name: string, path?: string): string => {
        const old = [...(previous?.bindings ?? [])].find(
          ([, item]) => item.kind === kind && item.name === name && item.path === path
        )
        const token = old?.[0] ?? randomUUID()
        bindings.set(token, { kind, name, path })
        return token
      }
      const commands = nativeCommands(native.commands).map((item) => ({
        ...item,
        id: bind('command', item.name),
        kind: 'native' as const,
        ...(item.name === 'init' && (id === 'claude' || id === 'claude-desktop')
          ? { targetFile: 'CLAUDE.md' as const }
          : {})
      }))
      const view: AgentCatalog = {
        connectionId: connection,
        sessionId: ref ?? '',
        commands,
        skills: native.skills
          .slice(0, 300)
          .filter((item) => item.name && item.path)
          .map((item) => ({
            id: bind('skill', item.name, item.path),
            kind: 'skill',
            label: item.name.slice(0, 120),
            description: item.description.slice(0, 500)
          })),
        mcp: native.mcp.slice(0, 100).map((server) => ({
          name: server.name.slice(0, 120),
          status: server.status.slice(0, 40),
          tools: server.tools.slice(0, 200).map((item) => ({
            id: bind('tool', `${server.name}/${item.name}`),
            kind: 'tool',
            label: item.name.slice(0, 120),
            description: item.description.slice(0, 500)
          }))
        })),
        notices: native.notices.slice(0, 8).map((item) => item.slice(0, 300)),
        extensionsEnabled: native.extensionsEnabled === true
      }
      if (!commands.some((item) => item.name === 'init'))
        view.commands.push({
          id: bind('command', 'init-workflow'),
          name: 'init',
          description: '生成项目说明；计划 / 只读模式仅建议，使用模型',
          argumentHint: '可选：需要补充的规则',
          kind: 'workflow',
          targetFile: 'AGENTS.md'
        })
      view.commands.push({
        id: bind('command', 'agents-workflow'),
        name: 'agents',
        description: '生成通用 AGENTS.md；计划 / 只读模式仅建议，使用模型',
        argumentHint: '可选：需要补充的规则',
        kind: 'workflow',
        targetFile: 'AGENTS.md'
      })
      this.catalogs.set(key, { view, bindings })
      return structuredClone(view)
    })
  }

  async setExtensions(
    id: CodingAgentId,
    owner: number,
    directory: string,
    enabled: boolean
  ): Promise<void> {
    const state = this.connected(id, owner)
    return this.operate(state, owner, true, async () => {
      if (
        this.directoryKey(directory) !== this.directoryKey(state.info.directory) ||
        !state.adapter.setExtensions
      )
        throw new CodingAgentError('此入口不支持本机扩展配置选择')
      state.adapter.setExtensions(directory, enabled)
      for (const key of this.catalogs.keys())
        if (key.startsWith(`${id}:`)) this.catalogs.delete(key)
    })
  }

  async executeCommand(
    owner: number,
    input: AgentCommandInput,
    references?: AgentReference[],
    refresh = true
  ): Promise<void> {
    const state = this.connected(input.runtimeId, owner)
    if (input.arguments.length > 10_000) throw new CodingAgentError('命令参数最多 10,000 字符')
    if (refresh) await this.readCatalog(input.runtimeId, owner, input.sessionId)
    return this.operate(state, owner, true, async () => {
      const session = this.session(state, input.sessionId)
      const action = this.catalogs
        .get(this.catalogKey(state, input.sessionId))
        ?.view.commands.find((item) => item.id === input.commandId)
      if (!action) throw new CodingAgentError('命令已失效，请刷新后重新选择；草稿已保留')
      if (session.status !== 'ready' && session.status !== 'error')
        throw new CodingAgentError('请先等待或停止当前任务')
      if (action.name === 'compact' && !session.messages.length)
        throw new CodingAgentError('当前没有可压缩的对话内容')
      if (action.name === 'compact' && state.adapter.compact && input.arguments)
        throw new CodingAgentError('当前原生压缩接口不支持附加说明，请移除参数后再执行')
      if (references?.length && (action.name === 'compact' || action.targetFile))
        throw new CodingAgentError('压缩或初始化不接受文件引用，请先移除引用')
      const { context, additions } = await this.resolveReferences(state, owner, session, references)
      const nativeContent = `/${action.name}${input.arguments ? ` ${input.arguments}` : ''}${additions.length ? `\n${additions.join('\n')}` : ''}`
      if (nativeContent.length > 50_000)
        throw new CodingAgentError('命令及引用超过 50,000 字符，请缩短任务')
      if (action.targetFile) {
        const root = await realpath(session.directory).catch(() => '')
        const target = `${root}/${action.targetFile}`
        if (!root) throw new CodingAgentError('项目目录已不可访问')
        if (await lstat(target).catch(() => null)) {
          throw new CodingAgentError(
            `${action.targetFile} 已存在。请在对话中明确要求查看或提出更新建议，本次未执行初始化`
          )
        }
      }
      this.begin(state, session)
      const option = (id: string): string | undefined =>
        session.options.find((item) => item.id === id)?.currentValue
      const canWrite =
        input.runtimeId === 'codex'
          ? option('permission') === 'workspace-write'
          : input.runtimeId === 'claude' || input.runtimeId === 'claude-desktop'
            ? ['auto', 'default', 'acceptEdits'].includes(option('permission') ?? '')
            : input.runtimeId === 'opencode' &&
              session.options.some(
                (item) => item.category === 'mode' && item.currentValue === 'build'
              )
      const active = this.active.get(input.runtimeId)
      if (action.targetFile && active && (action.kind === 'native' || canWrite))
        active.targetFile = action.targetFile
      console.info('[CodingAgent] 执行快捷操作', {
        runtimeId: input.runtimeId,
        kind: action.kind,
        operation: action.targetFile ? 'init' : 'command'
      })
      try {
        if (action.kind === 'workflow') {
          await state.adapter.send(
            session.nativeSessionId,
            `请阅读当前项目和已有协作规则，生成 ${action.targetFile}。${canWrite ? `只在当前项目根目录的该文件不存在时创建；已有文件绝不覆盖，只提出建议。保存仍遵守当前原生审批。` : '本次仅输出建议，不创建或修改文件。'}不执行安装、构建或测试，不读取敏感配置。明确区分已核实内容和待确认内容。补充要求：${input.arguments || '无'}`
          )
        } else if (action.name === 'compact' && state.adapter.compact) {
          await state.adapter.compact(session.nativeSessionId)
        } else {
          await state.adapter.send(session.nativeSessionId, nativeContent, {
            ...context,
            command: true
          })
        }
      } catch (error) {
        if (this.active.get(input.runtimeId)?.runId === session.runId) {
          this.finishTiming(session, this.active.get(input.runtimeId))
          this.active.delete(input.runtimeId)
          session.status = state.info.connected ? 'error' : 'disconnected'
          session.outcome = 'unknown'
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
    if (
      this.active.get(id)?.runId !== session.runId ||
      !session.approvals.some((a) => a.id === approvalId)
    )
      throw new CodingAgentError('该审批已结束或不属于当前运行')
    state.adapter.approve(session.nativeSessionId, approvalId, approved)
  }

  /** 回答属于控制请求，不能被仍等待原生响应的发送操作阻塞。 */
  answerQuestion(id: CodingAgentId, owner: number, ref: string, answer: AgentQuestionAnswer): void {
    const state = this.connected(id, owner)
    const session = this.session(state, ref)
    if (
      this.active.get(id)?.runId !== session.runId ||
      session.status !== 'running' ||
      !session.questions?.some((question) => question.id === answer.requestId) ||
      !state.adapter.answerQuestion
    )
      throw new CodingAgentError('问题已结束或不属于当前运行')
    state.adapter.answerQuestion(session.nativeSessionId, answer)
  }

  previewRevert(
    id: CodingAgentId,
    owner: number,
    ref: string,
    messageId: string
  ): Promise<CodingAgentRevertPreview> {
    const state = this.connected(id, owner)
    return this.operate(state, owner, true, async () => {
      const session = this.session(state, ref)
      this.requireIdleProject(session.directory)
      if (
        !session.canRevert ||
        !state.adapter.previewRevert ||
        !session.messages.some((message) => message.id === messageId && message.role === 'user')
      )
        throw new CodingAgentError('此消息没有可确认的原生回退能力')
      const preview = await state.adapter.previewRevert(session.nativeSessionId, messageId)
      if (this.connected(id, owner) !== state || session.connectionId !== state.info.connectionId)
        throw new CodingAgentError('连接已变化，请重新预览')
      this.requireIdleProject(session.directory)
      for (const [key, entry] of this.revertPreviews)
        if (entry.expiresAt < Date.now() || (entry.runtimeId === id && entry.sessionRef === ref))
          this.revertPreviews.delete(key)
      if (this.revertPreviews.size >= 40)
        throw new CodingAgentError('待确认回退过多，请稍后重新预览')
      const token = randomUUID()
      this.revertPreviews.set(token, {
        owner,
        runtimeId: id,
        connectionId: state.info.connectionId,
        sessionRef: ref,
        runId: session.runId,
        expiresAt: Date.now() + 5 * 60_000,
        preview
      })
      return {
        token,
        historyRevision: preview.revision,
        affectedTurns: preview.affectedTurns,
        affectedMessages: preview.affectedMessages,
        tail: preview.tail,
        originalText: preview.originalText
      }
    })
  }

  revert(
    id: CodingAgentId,
    owner: number,
    ref: string,
    token: string
  ): Promise<CodingAgentSessionView> {
    const state = this.connected(id, owner)
    return this.operate(state, owner, true, async () => {
      const session = this.session(state, ref)
      const entry = this.revertPreviews.get(token)
      if (
        !entry ||
        entry.owner !== owner ||
        entry.runtimeId !== id ||
        entry.sessionRef !== ref ||
        entry.connectionId !== state.info.connectionId ||
        entry.runId !== session.runId ||
        entry.expiresAt < Date.now() ||
        !state.adapter.revert
      )
        throw new CodingAgentError('回退预览已失效，请重新预览')
      this.requireIdleProject(session.directory)
      this.revertPreviews.delete(token)
      const key = this.directoryKey(session.directory)
      this.historyLocks.add(key)
      try {
        const raw = await state.adapter.revert(session.nativeSessionId, entry.preview)
        if (!state.info.connected || entry.connectionId !== state.info.connectionId)
          throw new CodingAgentError('连接已结束，请核对原生历史；未自动重试回退')
        // 原历史的耗时与上下文均不再代表回退后的分支。
        const previous = this.session(state, ref)
        previous.timing = undefined
        previous.contextUsage = undefined
        previous.outcome = 'completed'
        return this.upsert(state, raw, true)
      } catch (error) {
        if (error instanceof CodingAgentHistoryUnknownError) {
          const current = this.session(state, ref)
          current.status = state.info.connected ? 'error' : 'disconnected'
          current.outcome = 'unknown'
          current.canRevert = false
          current.error = error.message
          this.publishSession(state, current)
        }
        throw error
      } finally {
        this.historyLocks.delete(key)
      }
    })
  }

  /** 旧 OpenCode IPC 同样遵守本运行时互斥及项目冲突检查。 */
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
        if (channel === IPC.opencodeSend) this.requireIdleProject(state.info.directory)
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
    for (const [token, entry] of this.revertPreviews)
      if (entry.owner === owner) this.revertPreviews.delete(token)
    this.selectedDirectories.delete(owner)
    this.files.release(`${owner}:`)
    for (const state of this.runtimes.values()) {
      if (state.owner !== owner) continue
      state.owner = null
      state.adapter.disconnect()
    }
  }

  dispose(): void {
    this.revertPreviews.clear()
    this.historyLocks.clear()
    this.listeners.clear()
    this.active.clear()
    for (const state of this.runtimes.values()) {
      state.owner = null
      state.dispose()
      state.adapter.disconnect()
    }
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
    if (idle && this.active.has(state.adapter.id))
      throw new CodingAgentError('请先等待或停止当前 Agent 正在运行的编程任务')
    if (!control) state.busy = true
    try {
      return await action()
    } finally {
      if (!control) state.busy = false
    }
  }

  private prepareConnection(state: RuntimeState, owner: number): void {
    for (const key of this.catalogs.keys())
      if (key.startsWith(`${state.adapter.id}:`)) this.catalogs.delete(key)
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

  private finishTiming(session: CodingAgentSessionView, run?: ActiveRun): void {
    if (session.timing && run?.sessionRef === session.id)
      session.timing = {
        ...session.timing,
        finishedAt: Date.now(),
        elapsedMs: Math.max(0, Math.floor(performance.now() - run.startedAt))
      }
  }

  private begin(state: RuntimeState, session: CodingAgentSessionView): void {
    // 检查与占位同步完成，两个异步发送准备不能同时抢到同一项目。
    this.requireIdleProject(session.directory)
    session.runId = randomUUID()
    session.outcome = null
    session.error = ''
    session.timing = { startedAt: Date.now() }
    if (session.contextUsage) session.contextUsage = { ...session.contextUsage, stale: true }
    this.active.set(state.adapter.id, {
      runtimeId: state.adapter.id,
      sessionRef: session.id,
      runId: session.runId,
      directory: session.directory,
      startedAt: performance.now()
    })
  }

  private requireIdleProject(directory: string): void {
    if (this.historyLocks.has(this.directoryKey(directory)))
      throw new CodingAgentError('此项目正在回退原生历史，请稍候再发送')
    for (const run of this.active.values()) {
      if (this.directoryKey(run.directory) === this.directoryKey(directory))
        throw new CodingAgentError('请先等待或停止正在运行的相同项目任务')
    }
  }

  private receive(state: RuntimeState, event: NativeCodingEvent): void {
    if (event.kind === 'runtime') {
      this.updateInfo(state, event.runtime)
      return
    }
    if (event.kind === 'connection') {
      if (!event.connected) {
        state.info.connected = false
        for (const session of state.sessions.values()) {
          if (session.status === 'running' || session.status === 'stopping') {
            session.outcome = 'unknown'
            session.error = '连接中断，任务结果未知；请核对原生会话，不会自动重发'
            for (const tool of session.tools)
              if (!['completed', 'failed', 'cancelled'].includes(tool.status))
                tool.status = 'unknown'
            for (const child of session.subtasks)
              if (!['completed', 'errored', 'shutdown', 'interrupted'].includes(child.status))
                child.status = 'unknown'
          }
          session.status = 'disconnected'
          this.finishTiming(session, this.active.get(state.adapter.id))
          session.questions = []
          this.publishSession(state, session)
        }
        this.active.delete(state.adapter.id)
        this.publishRuntime(state)
      }
      return
    }
    const previous = state.sessions.get(event.session.id)
    if (previous?.historyRevision && event.session.historyRevision !== previous.historyRevision)
      return
    this.upsert(state, event.session)
  }

  private upsert(
    state: RuntimeState,
    raw: NativeCodingSession,
    historyReload = false
  ): CodingAgentSessionView {
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
    view.timing = previous?.timing
    const usage = raw.contextUsage ?? previous?.contextUsage
    if (usage) {
      const model = (item: NativeCodingSession) =>
        item.options.find((option) => option.category === 'model')?.currentValue
      const changedModel = previous && model(previous) !== model(raw)
      const remainsStale =
        previous?.contextUsage?.stale && usage.measuredAt <= previous.contextUsage.measuredAt
      const unmeasuredReload = historyReload && !raw.contextUsage
      view.contextUsage = {
        ...usage,
        ...(changedModel || remainsStale || unmeasuredReload ? { stale: true } : {})
      }
    }
    if (raw.status === 'running' && !this.active.has(state.adapter.id) && state.legacySending)
      this.begin(state, view)
    const run = this.active.get(state.adapter.id)
    const active = run?.sessionRef === view.id && run.runId === view.runId
    const targetFile = active ? run.targetFile : undefined
    if (active && raw.status !== 'running' && raw.status !== 'stopping') {
      this.finishTiming(view, run)
      view.outcome =
        raw.outcome ??
        (raw.status === 'disconnected'
          ? 'unknown'
          : raw.status === 'error'
            ? 'failed'
            : previous?.status === 'stopping'
              ? 'stopped'
              : 'completed')
      this.active.delete(state.adapter.id)
    } else if (
      !active &&
      !historyReload &&
      previous?.outcome !== null &&
      previous?.outcome !== undefined
    ) {
      // 已结算后的标题 / 配置可更新，迟到正文与工具分片不能复活或污染运行。
      view.messages = previous.messages
      view.tools = previous.tools
      view.subtasks = previous.subtasks
      view.status = raw.status === 'disconnected' ? raw.status : previous.status
    }
    state.sessions.set(raw.id, view)
    this.publishSession(state, view)
    if (targetFile && view.outcome === 'completed') {
      // 原生回复不是文件存在证据；只检查声明的目标和落点，不读取正文。
      void this.checkInitializedFile(state, view, targetFile)
    }
    return structuredClone(view)
  }

  private async checkInitializedFile(
    state: RuntimeState,
    view: CodingAgentSessionView,
    name: string
  ): Promise<void> {
    const root = await realpath(view.directory).catch(() => '')
    const target = root ? await realpath(`${root}/${name}`).catch(() => '') : ''
    const exists = Boolean(
      target && withinProject(root, target) && (await stat(target).catch(() => null))?.isFile()
    )
    if (
      state.sessions.get(view.nativeSessionId) !== view ||
      view.connectionId !== state.info.connectionId
    )
      return
    view.tools.push({
      id: `init-check-${view.runId}`,
      title: exists ? `已检查：${name} 已生成` : `未发现项目内的 ${name}，请核对任务结果`,
      status: exists ? 'completed' : 'failed'
    })
    this.publishSession(state, view)
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
