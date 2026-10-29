import { randomUUID } from 'node:crypto'
import { agentPreferences } from '../../../shared/agent-projects'
import { realpath, stat } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import type {
  ModelInfo,
  Options,
  PermissionResult,
  Query,
  SDKUserMessage
} from '@anthropic-ai/claude-agent-sdk'
import type {
  CodingAgentRuntimeView,
  CodingAgentSessionSummary
} from '../../../shared/coding-agents'
import { normalizeDraftDirectory } from '../../../shared/agent-drafts'
import { acpPreview } from './acp-codec'
import type { ToolboxStore } from '../chat-store/chat-store'
import {
  CodingAgentError,
  type CodingAgentAdapter,
  type NativeCodingEvent,
  type NativeCodingSession
} from './adapter'
import { bundledClaudeExecutable, inspectClaudeExecutable } from './claude-runtime'
import { readClaudeProviderSettings } from './claude-provider-settings'
import type { ClaudeProviderSettings } from './claude-provider-settings'
import { assertDesktopCodeIdle, readDesktopCodeSessions } from './claude-desktop-history'
import type { NativeSendContext } from './adapter'
import { nativeCommands, type NativeAgentCatalog } from './agent-action-catalog'
import type { DesktopCodeSession } from './claude-desktop-history'

export type ClaudeSdk = Pick<
  typeof import('@anthropic-ai/claude-agent-sdk'),
  'query' | 'listSessions' | 'getSessionMessages'
>
const object = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
const text = (value: unknown, limit = 200): string =>
  typeof value === 'string' ? value.slice(0, limit) : ''
const DEFAULT_MODEL = 'native-default'
const DEFAULT_MODEL_LABEL = '沿用 Claude / CC Switch 配置'
const CLAUDE_PERMISSION_OPTIONS = [
  { value: 'auto', label: '自动 · Auto' },
  { value: 'default', label: '手动 · Manual' },
  { value: 'acceptEdits', label: '接受编辑 · Accept edits' },
  { value: 'plan', label: '计划 · Plan' }
] as const

/** 保持 stdin 打开，空输入只做初始化；只有显式发送才 yield 用户消息。 */
function inputFeed(
  content?: string,
  paused = false
): { input: AsyncIterable<SDKUserMessage>; close(): void; start(): void } {
  let release: (() => void) | null = null
  let start: (() => void) | null = null
  const admitted = paused
    ? new Promise<void>((resolve) => {
        start = resolve
      })
    : Promise.resolve()
  let closed = false
  return {
    input: (async function* () {
      await admitted
      if (!closed && content !== undefined)
        yield {
          type: 'user' as const,
          message: { role: 'user' as const, content },
          parent_tool_use_id: null
        }
      if (!closed)
        await new Promise<void>((resolve) => {
          release = resolve
        })
    })(),
    close: () => {
      closed = true
      start?.()
      release?.()
    },
    start: () => start?.()
  }
}

/** 一个自有 SDK query 的生命周期，终态后忽略迟到事件及审批。 */
interface ClaudeRun {
  compacting?: boolean
  session: NativeCodingSession
  controller: AbortController
  query: Query
  closeInput(): void
  timer: NodeJS.Timeout
  stopped: boolean
  completed: boolean
  messageId: string
}

/** 官方 SDK 独立运行时；供应商凭据只用于子进程，不把初始化成功当作推理可用保证。 */
export class ClaudeAdapter implements CodingAgentAdapter {
  private readonly commandLists = new Map<string, NativeAgentCatalog['commands']>()
  private generation = 0
  private sdk: ClaudeSdk | null = null
  private models: ModelInfo[] = []
  private sessions = new Map<string, NativeCodingSession>()
  private persisted = new Set<string>()
  private nativeDesktopIds = new Set<string>()
  private listeners = new Set<(event: NativeCodingEvent) => void>()
  private approvals = new Map<string, { run: ClaudeRun; settle(allowed: boolean): void }>()
  private run: ClaudeRun | null = null
  private preparing: { sessionId: string; controller: AbortController } | null = null
  private updateTimer: NodeJS.Timeout | null = null
  private probes = new Set<() => void>()
  private info: Omit<CodingAgentRuntimeView, 'connectionId'> = {
    runtimeId: 'claude',
    name: 'Claude Code',
    executablePath: null,
    directory: '',
    version: null,
    available: true,
    connected: false,
    canLoadSession: true,
    visibleModelIds: [DEFAULT_MODEL],
    detail:
      '官方 SDK；沿用 Claude / CC Switch 的用户供应商路由与模型配置。默认计划模式；不加载用户/项目 hooks、MCP 或权限规则，不改原生配置。',
    capabilities: {
      history: 'supported',
      resume: 'supported',
      subagents: 'unsupported',
      stopSubagent: 'unsupported',
      usage: 'unknown',
      desktopHistory: 'unknown'
    }
  }

  constructor(
    private readonly store: Pick<ToolboxStore, 'configGet' | 'configSet'>,
    private readonly loadSdk: () => Promise<ClaudeSdk> = () =>
      import('@anthropic-ai/claude-agent-sdk'),
    private readonly readProvider: () => Promise<ClaudeProviderSettings> =
      readClaudeProviderSettings,
    readonly id: 'claude' | 'claude-desktop' = 'claude',
    private readonly readDesktopHistory: (directory: string) => Promise<DesktopCodeSession[]> =
      readDesktopCodeSessions,
    private readonly assertDesktopIdle: () => Promise<void> = assertDesktopCodeIdle
  ) {
    if (id === 'claude-desktop') {
      this.info.runtimeId = id
      this.info.name = 'Claude Desktop'
      this.info.detail =
        '沿用 Desktop 第三方网关，由 SDK 执行；历史仅列当前项目已结束的 Code 会话。工具箱新建会话不会自动出现在 Desktop；续接前需退出外部 Claude。不含普通 Chat。'
      this.info.capabilities.desktopHistory = 'supported'
    }
  }

  private get configKey(): string {
    return this.id === 'claude' ? 'claude' : 'claudeDesktop'
  }

  private get defaultModelLabel(): string {
    return this.id === 'claude' ? DEFAULT_MODEL_LABEL : 'Desktop 配置首个模型'
  }

  private savePreferences(patch: Record<string, unknown>): void {
    this.store.configSet({
      [this.configKey]: { ...agentPreferences(this.store.configGet(), this.id), ...patch }
    })
  }

  private extensionsEnabled(directory: string): boolean {
    const roots = agentPreferences(this.store.configGet(), this.id).extensionDirectories
    return (
      Array.isArray(roots) &&
      roots
        .slice(0, 100)
        .some(
          (root) =>
            typeof root === 'string' &&
            normalizeDraftDirectory(root) === normalizeDraftDirectory(directory)
        )
    )
  }

  setExtensions(directory: string, enabled: boolean): void {
    const raw = agentPreferences(this.store.configGet(), this.id).extensionDirectories
    const roots = (Array.isArray(raw) ? raw : []).filter(
      (item): item is string =>
        typeof item === 'string' &&
        item.length <= 4096 &&
        normalizeDraftDirectory(item) !== normalizeDraftDirectory(directory)
    )
    this.savePreferences({
      extensionDirectories: [...roots.slice(-99), ...(enabled ? [directory] : [])]
    })
    this.commandLists.clear()
  }

  /** 只记录本入口的原生 ID，不保存正文或认证；损坏时拒绝混合两个来源的历史。 */
  private desktopSessionIds(): string[] {
    const value = agentPreferences(this.store.configGet(), 'claude-desktop').sessionIds
    if (value === undefined) return []
    if (
      !Array.isArray(value) ||
      value.length > 10000 ||
      !value.every(
        (id): id is string =>
          typeof id === 'string' && id.length > 0 && id.length <= 200 && !/[\0\r\n]/.test(id)
      )
    )
      throw new CodingAgentError('Claude Desktop 历史来源索引无效，原有记录已保留')
    return value
  }

  private rememberDesktopSession(id: string): void {
    if (this.id !== 'claude-desktop' || this.nativeDesktopIds.has(id)) return
    const ids = this.desktopSessionIds()
    if (ids.includes(id)) return
    if (ids.length >= 10000)
      throw new CodingAgentError('Claude Desktop 会话来源记录已达上限，未发送任务')
    this.savePreferences({ sessionIds: [...ids, id] })
  }

  subscribe(listener: (event: NativeCodingEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
  private emit(session: NativeCodingSession, immediate = true): void {
    if (!immediate) {
      if (!this.updateTimer)
        this.updateTimer = setTimeout(() => {
          this.updateTimer = null
          this.emit(session)
        }, 40)
      return
    }
    if (this.updateTimer) clearTimeout(this.updateTimer)
    this.updateTimer = null
    for (const listener of this.listeners)
      listener({ kind: 'session', session: structuredClone(session) })
  }

  async inspect(): Promise<Omit<CodingAgentRuntimeView, 'connectionId'>> {
    if (!this.info.connected) {
      const generation = this.generation
      const config = agentPreferences(this.store.configGet(), this.id)
      const executablePath = text(config?.executablePath, 4096) || (await bundledClaudeExecutable())
      if (generation !== this.generation) throw new CodingAgentError('Claude 检测已失效，请重试')
      this.info.executablePath = executablePath
      this.info.directory = text(config?.directory, 4096)
    } else if (this.sdk && !this.run && !this.preparing) {
      const generation = this.generation
      const models = await this.probeModels(this.sdk, this.info.directory)
      if (generation !== this.generation) throw new CodingAgentError('Claude 连接已结束')
      this.models = models
      this.info.visibleModelIds = [DEFAULT_MODEL, ...models.map((model) => model.value)]
      for (const session of this.sessions.values()) {
        const option = session.options.find((option) => option.id === 'model')
        if (option)
          option.options = [
            { value: DEFAULT_MODEL, label: this.defaultModelLabel },
            ...models.map((model) => ({ value: model.value, label: model.displayName }))
          ]
        this.emit(session)
      }
    }
    return structuredClone(this.info)
  }

  async selectExecutable(path: string): Promise<Omit<CodingAgentRuntimeView, 'connectionId'>> {
    const result = await inspectClaudeExecutable(path)
    this.savePreferences({ executablePath: result.path })
    this.info.executablePath = result.path
    this.info.version = result.version
    return structuredClone(this.info)
  }

  private async options(
    directory: string,
    controller: AbortController
  ): Promise<{ options: Options; models?: ModelInfo[] }> {
    const provider = await this.readProvider()
    const env: Record<string, string | undefined> = {
      ...process.env,
      ...provider.env,
      CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: '1'
    }
    if (this.id === 'claude-desktop') {
      for (const key of Object.keys(env))
        if (
          /^(?:ANTHROPIC_|CLAUDE_CODE_OAUTH_TOKEN)/.test(key) ||
          /^CLAUDE_CODE_USE_(?:BEDROCK|VERTEX|FOUNDRY)$/.test(key)
        )
          delete env[key]
      Object.assign(env, provider.env)
    }
    delete env.ELECTRON_RUN_AS_NODE
    for (const key of Object.keys(env))
      if (/^CLAUDE_CODE_(?:RESUME|REMOTE)/.test(key)) delete env[key]
    for (const key of Object.keys(env))
      if (/^(OPENAI|OPENCODE|KIMI|MOONSHOT|DEEPSEEK)_/i.test(key) && /KEY|TOKEN|SECRET/i.test(key))
        delete env[key]
    return {
      options: {
        cwd: directory,
        env,
        model: env.ANTHROPIC_MODEL || provider.model,
        abortController: controller,
        pathToClaudeCodeExecutable: this.info.executablePath!,
        // Desktop 不加载 CLI 的用户设置，避免把 CC Switch CLI 路由带入另一入口。
        settingSources: this.extensionsEnabled(directory)
          ? this.id === 'claude-desktop'
            ? ['project', 'local']
            : ['user', 'project', 'local']
          : [],
        permissionMode: 'plan',
        includePartialMessages: true,
        systemPrompt: { type: 'preset', preset: 'claude_code' },
        canUseTool: async () => ({ behavior: 'deny', message: '连接初始化不执行工具' }),
        onUserDialog: async () => ({ behavior: 'cancelled' })
      },
      models: provider.models?.map((model) => ({
        value: model.value,
        displayName: model.label,
        description: ''
      }))
    }
  }

  async connect(directory: string): Promise<Omit<CodingAgentRuntimeView, 'connectionId'>> {
    if (!isAbsolute(directory) || !(await stat(directory).catch(() => null))?.isDirectory())
      throw new CodingAgentError('请选择存在的项目绝对目录')
    this.disconnect()
    const generation = this.generation
    await this.inspect()
    if (!this.info.executablePath)
      throw new CodingAgentError('Claude 原生组件不可用，请在连接设置中选择官方 CLI')
    const executable = await inspectClaudeExecutable(this.info.executablePath)
    const cwd = await realpath(directory)
    const sdk = await this.loadSdk()
    if (generation !== this.generation) throw new CodingAgentError('Claude 连接已结束')
    const models = await this.probeModels(sdk, cwd)
    if (generation !== this.generation) throw new CodingAgentError('Claude 连接已结束')
    this.models = models
    this.sdk = sdk
    this.info = {
      ...this.info,
      executablePath: executable.path,
      version: executable.version,
      directory: cwd,
      connected: true,
      visibleModelIds: [DEFAULT_MODEL, ...this.models.map((model) => model.value)]
    }
    this.savePreferences({ directory: cwd })
    return structuredClone(this.info)
  }

  private async probeModels(sdk: ClaudeSdk, directory: string): Promise<ModelInfo[]> {
    const generation = this.generation
    const controller = new AbortController()
    const feed = inputFeed()
    const { options, models: configured } = await this.options(directory, controller)
    if (generation !== this.generation) throw new CodingAgentError('Claude 连接已结束')
    const query = sdk.query({ prompt: feed.input, options })
    const dispose = (): void => {
      controller.abort()
      query.close()
      feed.close()
    }
    this.probes.add(dispose)
    const timeout = setTimeout(dispose, 20_000)
    try {
      // 公开初始化/模型接口，不 yield 用户消息，不触发模型生成。
      let models: ModelInfo[]
      if (configured) {
        await query.initializationResult()
        models = configured
      } else models = await query.supportedModels()
      return models
        .slice(0, 200)
        .filter(
          (model) =>
            typeof model.value === 'string' && model.value.length > 0 && model.value.length <= 200
        )
        .map((model) => ({
          value: model.value,
          displayName: text(model.displayName, 100) || model.value,
          description: '',
          supportedEffortLevels: Array.isArray(model.supportedEffortLevels)
            ? model.supportedEffortLevels.filter((level) =>
                ['low', 'medium', 'high', 'xhigh', 'max'].includes(level)
              )
            : []
        }))
    } catch {
      throw new CodingAgentError('Claude 初始化失败，请检查官方认证和 CLI；未发送任务')
    } finally {
      clearTimeout(timeout)
      this.probes.delete(dispose)
      dispose()
    }
  }

  disconnect(): void {
    this.commandLists.clear()
    this.generation++
    this.preparing?.controller.abort()
    this.preparing = null
    for (const dispose of this.probes) dispose()
    this.probes.clear()
    if (this.updateTimer) clearTimeout(this.updateTimer)
    this.updateTimer = null
    if (this.run) {
      const run = this.run
      this.run = null
      clearTimeout(run.timer)
      this.resolveApprovals(run)
      run.closeInput()
      run.controller.abort()
      run.query.close()
    }
    this.sessions.clear()
    this.persisted.clear()
    this.nativeDesktopIds.clear()
    this.sdk = null
    this.info.connected = false
    for (const listener of this.listeners) listener({ kind: 'connection', connected: false })
  }

  async listSessions(): Promise<CodingAgentSessionSummary[]> {
    if (!this.sdk || !this.info.connected) throw new CodingAgentError('Claude 尚未连接')
    const generation = this.generation
    const directory = this.info.directory
    const [native, items] = await Promise.all([
      this.readDesktopHistory(directory),
      this.sdk.listSessions({ dir: directory, limit: 2000, includeWorktrees: false })
    ])
    if (generation !== this.generation) throw new CodingAgentError('Claude 连接已结束')
    const nativeById = new Map(native.map((item) => [item.id, item]))
    const desktopIds = new Set([...this.desktopSessionIds(), ...nativeById.keys()])
    if (this.id === 'claude-desktop')
      for (const id of nativeById.keys()) this.nativeDesktopIds.add(id)
    return items
      .filter(
        (item) =>
          (!item.cwd || normalizeDraftDirectory(item.cwd) === normalizeDraftDirectory(directory)) &&
          (this.id === 'claude-desktop'
            ? desktopIds.has(item.sessionId) && nativeById.get(item.sessionId)?.resumable !== false
            : !desktopIds.has(item.sessionId))
      )
      .slice(0, 200)
      .map((item) => ({
        id: item.sessionId,
        title:
          (this.id === 'claude-desktop' ? nativeById.get(item.sessionId)?.title : '') ||
          text(item.customTitle || item.summary || item.firstPrompt, 100) ||
          'Claude 会话'
      }))
  }

  async openSession(id?: string): Promise<NativeCodingSession> {
    if (!this.sdk || !this.info.connected) throw new CodingAgentError('Claude 尚未连接')
    if (this.run || this.preparing) throw new CodingAgentError('请先停止任务再刷新 Claude 历史')
    const sdk = this.sdk
    const generation = this.generation
    const directory = this.info.directory
    let title = `${this.info.name} 新会话`
    const nativeId = id ?? randomUUID()
    let messages: NativeCodingSession['messages'] = []
    let historyLimited = false
    if (id) {
      const item = (await this.listSessions()).find((item) => item.id === id)
      if (!item) throw new CodingAgentError('此 Claude 历史不属于当前项目或已失效，草稿仍可取回')
      if (generation !== this.generation) throw new CodingAgentError('Claude 连接已结束')
      title = item.title
      const records = await sdk.getSessionMessages(id, {
        dir: directory,
        limit: 201
      })
      if (generation !== this.generation) throw new CodingAgentError('Claude 连接已结束')
      historyLimited = records.length > 200
      messages = records
        .slice(0, 200)
        .filter(
          (item) =>
            item.parent_tool_use_id === null && (item.type === 'user' || item.type === 'assistant')
        )
        .flatMap((item) => {
          const content = this.messageText(object(item.message)?.content)
          return content
            ? [{ id: item.uuid, role: item.type as 'user' | 'assistant', content }]
            : []
        })
      this.persisted.add(id)
    }
    const session: NativeCodingSession = {
      id: nativeId,
      title,
      directory,
      status: 'ready',
      messages,
      tools: [],
      approvals: [],
      error: '',
      options: [
        {
          id: 'model',
          category: 'model',
          name: '模型',
          currentValue: DEFAULT_MODEL,
          options: [
            { value: DEFAULT_MODEL, label: this.defaultModelLabel },
            ...this.models.map((model) => ({
              value: model.value,
              label: model.displayName || model.value
            }))
          ]
        },
        {
          id: 'permission',
          category: 'permission',
          name: '操作权限',
          currentValue: 'plan',
          options: CLAUDE_PERMISSION_OPTIONS.map((item) => ({ ...item }))
        }
      ]
    }
    let remaining = 200_000
    session.messages = session.messages.flatMap((message) => {
      if (remaining <= 0) return []
      const content = message.content.slice(0, remaining)
      remaining -= content.length
      return [{ ...message, content }]
    })
    if (historyLimited || remaining === 0 || messages.length >= 200)
      session.error = '历史仅显示前 200 条、最多 200,000 字符，请在原生客户端查看完整记录'
    // 只刷新正文，不把用户已选的模型、思考强度和操作模式重置为默认值。
    const previous = this.sessions.get(nativeId)
    if (previous) session.options = structuredClone(previous.options)
    this.sessions.set(nativeId, session)
    return structuredClone(session)
  }

  async setOption(id: string, optionId: string, value: string): Promise<NativeCodingSession> {
    const session = this.session(id)
    if (session.status === 'running' || session.status === 'stopping')
      throw new CodingAgentError('请先停止任务再切换选项')
    const option = session.options.find((option) => option.id === optionId)
    if (!option?.options.some((item) => item.value === value))
      throw new CodingAgentError('Claude 选项不可用')
    option.currentValue = value
    if (optionId === 'model') {
      session.options = session.options.filter((item) => item.id !== 'effort')
      const levels = this.models.find((item) => item.value === value)?.supportedEffortLevels
      if (levels?.length)
        session.options.push({
          id: 'effort',
          category: 'thought_level',
          name: '思考强度',
          currentValue: levels.includes('high') ? 'high' : levels[0],
          options: levels.map((value) => ({ value, label: value }))
        })
    }
    return structuredClone(session)
  }

  async catalog(id?: string): Promise<NativeAgentCatalog> {
    if (!this.sdk || !this.info.connected) throw new CodingAgentError('请先连接 Claude')
    if (this.run || this.preparing) throw new CodingAgentError('请在当前 Claude 任务结束后读取扩展')
    const generation = this.generation
    const controller = new AbortController()
    const feed = inputFeed()
    const prepared = await this.options(this.info.directory, controller)
    const query = this.sdk.query({ prompt: feed.input, options: prepared.options })
    const dispose = (): void => {
      controller.abort()
      query.close()
      feed.close()
    }
    this.probes.add(dispose)
    const timer = setTimeout(dispose, 20_000)
    try {
      // 只发 SDK 控制请求，不 yield 用户消息，也不为发现恢复 / 新建会话。
      const [initial, skills, servers] = await Promise.all([
        query.initializationResult(),
        query.supportedCommands(),
        query.mcpServerStatus()
      ])
      if (generation !== this.generation) throw new CodingAgentError('Claude 连接已变化')
      const commands = nativeCommands([
        ...initial.commands,
        ...skills,
        ...(id ? (this.commandLists.get(id) ?? []) : [])
      ])
      return {
        commands,
        // SDK 混合返回内置命令与 Skill，不能把 compact/init 误标成 Skill。
        skills: [],
        mcp: servers.slice(0, 100).map((server) => ({
          name: server.name,
          status: server.status,
          tools: (server.tools ?? [])
            .slice(0, 200)
            .map((tool) => ({ name: tool.name, description: '' }))
        })),
        extensionsEnabled: this.extensionsEnabled(this.info.directory),
        notices: [
          this.extensionsEnabled(this.info.directory)
            ? this.id === 'claude-desktop'
              ? '已加载项目 / 本地扩展；Desktop 入口不加载 CLI 用户设置或账户连接器。'
              : '已加载用户 / 项目 / 本地扩展；配置可能包含 hooks、插件、MCP 与原生权限规则。'
            : '本机扩展配置未开启；可在连接设置中为此项目开启。',
          'SDK 将 Skill 和命令统一列出，可按名称搜索调用；终端专属命令不可用。'
        ]
      }
    } catch {
      return {
        commands: [],
        skills: [],
        mcp: [],
        extensionsEnabled: this.extensionsEnabled(this.info.directory),
        notices: [
          'Claude 扩展读取失败，请检查原生配置，或在连接设置中关闭扩展后重试；未发送模型任务'
        ]
      }
    } finally {
      clearTimeout(timer)
      this.probes.delete(dispose)
      dispose()
    }
  }

  async send(id: string, content: string, context?: NativeSendContext): Promise<void> {
    const session = this.session(id)
    if (this.run || this.preparing || !this.sdk)
      throw new CodingAgentError('Claude 正在执行任务或已断开')
    if (
      !context?.command &&
      (session.messages.length >= 200 ||
        session.messages.reduce((total, message) => total + message.content.length, 0) +
          content.length >
          200_000)
    )
      throw new CodingAgentError('会话达到显示上限，请开始新对话或在原生客户端继续')
    const controller = new AbortController()
    const generation = this.generation
    const preparing = { sessionId: id, controller }
    this.preparing = preparing
    let options: Options
    let currentModels: ModelInfo[] | undefined
    try {
      const prepared = await this.options(session.directory, controller)
      options = prepared.options
      currentModels = prepared.models
      if (this.id === 'claude-desktop' && this.persisted.has(id)) {
        const native = (await this.readDesktopHistory(session.directory)).find(
          (item) => item.id === id
        )
        if (controller.signal.aborted || generation !== this.generation)
          throw new CodingAgentError('已停止准备，草稿已保留')
        if (native) {
          if (!native.resumable)
            throw new CodingAgentError('Desktop 原会话尚未结束、正在等待处理或已归档；本次未发送')
          this.nativeDesktopIds.add(id)
          await this.assertDesktopIdle()
        } else if (this.nativeDesktopIds.has(id)) {
          throw new CodingAgentError('Desktop 原会话已失效，请刷新历史；草稿已保留')
        }
      }
    } finally {
      if (this.preparing === preparing) this.preparing = null
    }
    if (controller.signal.aborted) throw new CodingAgentError('已停止准备，草稿已保留')
    if (generation !== this.generation || !this.sdk || this.run)
      throw new CodingAgentError('Claude 连接或任务状态已变化，草稿已保留')
    const selected = (key: string): string | undefined =>
      session.options.find((item) => item.id === key)?.currentValue
    const permissionMode = CLAUDE_PERMISSION_OPTIONS.find(
      (item) => item.value === selected('permission')
    )
    if (!permissionMode) throw new CodingAgentError('Claude 操作模式不可用，请重新选择')
    options.permissionMode = permissionMode.value
    if (selected('model') !== DEFAULT_MODEL) {
      if (currentModels && !currentModels.some((model) => model.value === selected('model')))
        throw new CodingAgentError('当前 Desktop 模型已不可用，请在更多菜单同步模型后重新选择')
      options.model = selected('model')
    }
    const effort = selected('effort')
    if (effort && ['low', 'medium', 'high', 'xhigh', 'max'].includes(effort))
      options.effort = effort as Options['effort']
    if (this.persisted.has(id)) options.resume = id
    else options.sessionId = id
    options.canUseTool = (name, input, context) => this.permission(run, name, input, context.signal)
    options.onUserDialog = async () => {
      this.unsupportedQuestion(run)
      return { behavior: 'cancelled' }
    }
    this.rememberDesktopSession(id)
    const feed = inputFeed(content, context?.command === true)
    const query = this.sdk.query({ prompt: feed.input, options })
    const run: ClaudeRun = {
      session,
      controller,
      query,
      closeInput: feed.close,
      timer: setTimeout(() => {
        if (this.run === run) {
          session.error = 'Claude 长时间未结束，已停止本项目拥有的任务'
          this.stop(id)
        }
      }, 30 * 60_000),
      stopped: false,
      completed: false,
      messageId: ''
    }
    this.run = run
    // 一旦尝试创建就固定原生身份；后续失败也不能偷偷当作新会话覆盖或重发。
    this.persisted.add(id)
    session.status = 'running'
    session.error = ''
    session.outcome = null
    session.tools = []
    run.compacting = Boolean(context?.command && /^\/compact(?:\s|$)/.test(content))
    if (!run.compacting) session.messages.push({ id: randomUUID(), role: 'user', content })
    this.emit(session)
    void this.consume(run)
    let timeout: NodeJS.Timeout | undefined
    try {
      const initialized = await Promise.race([
        query.initializationResult(),
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(() => reject(new CodingAgentError('Claude 初始化超时')), 20_000)
        })
      ])
      if (context?.command) {
        const name = /^\/([\w:.-]+)/.exec(content)?.[1]
        if (!nativeCommands(initialized.commands).some((item) => item.name === name))
          throw new CodingAgentError('当前命令已失效或不适用于 SDK，本次未发送模型任务')
        feed.start()
      }
      if (run.stopped || (this.run !== run && session.outcome !== 'completed'))
        throw new CodingAgentError('Claude 尚未确认开始')
    } catch (error) {
      const message =
        error instanceof CodingAgentError
          ? error.message
          : 'Claude 任务未确认开始，草稿已保留；请核对原生会话后再操作'
      if (this.run === run) {
        this.run = null
        clearTimeout(run.timer)
        this.resolveApprovals(run)
        run.closeInput()
        run.controller.abort()
        run.query.close()
        session.status = 'error'
        session.outcome = 'failed'
        session.error = message
        this.emit(session)
      }
      throw new CodingAgentError(run.stopped ? '已停止准备，草稿已保留' : message)
    } finally {
      if (timeout) clearTimeout(timeout)
    }
  }

  stop(id: string): void {
    if (this.preparing?.sessionId === id) {
      this.preparing.controller.abort()
      this.preparing = null
    }
    const run = this.run
    if (!run || run.session.id !== id) return
    run.stopped = true
    this.run = null
    clearTimeout(run.timer)
    this.resolveApprovals(run)
    run.closeInput()
    run.controller.abort()
    run.query.close()
    run.session.status = 'ready'
    run.session.outcome = 'stopped'
    this.emit(run.session)
  }

  approve(id: string, approvalId: string, approved: boolean): void {
    const pending = this.approvals.get(approvalId)
    if (!pending || pending.run !== this.run || pending.run.session.id !== id)
      throw new CodingAgentError('Claude 审批已失效')
    pending.settle(approved)
  }

  private session(id: string): NativeCodingSession {
    const session = this.sessions.get(id)
    if (!session || !this.info.connected)
      throw new CodingAgentError('Claude 会话已失效，请从历史恢复')
    return session
  }
  private messageText(value: unknown): string {
    if (typeof value === 'string') return value.slice(0, 200_000)
    let result = ''
    if (Array.isArray(value))
      for (const block of value.slice(0, 2000)) {
        if (object(block)?.type !== 'text') continue
        result += (result ? '\n' : '') + text(object(block)?.text, 200_000 - result.length)
        if (result.length >= 200_000) break
      }
    return result
  }
  private unsupportedQuestion(run: ClaudeRun): void {
    if (this.run !== run) return
    run.session.error = 'Claude 请求了结构化问答；当前工作台暂不支持，请在原生客户端继续'
    this.stop(run.session.id)
  }
  private permission(
    run: ClaudeRun,
    name: string,
    input: Record<string, unknown>,
    signal: AbortSignal
  ): Promise<PermissionResult> {
    if (this.run !== run || signal.aborted)
      return Promise.resolve({ behavior: 'deny', message: '任务已结束' })
    if (name === 'AskUserQuestion' || name === 'ExitPlanMode') {
      this.unsupportedQuestion(run)
      return Promise.resolve({
        behavior: 'deny',
        message: '当前工作台暂不支持结构化问答或计划确认，请在原生客户端继续',
        interrupt: true
      })
    }
    return new Promise((resolve) => {
      const id = randomUUID()
      const settle = (allowed: boolean): void => {
        if (!this.approvals.has(id)) return
        this.approvals.delete(id)
        signal.removeEventListener('abort', abort)
        run.session.approvals = run.session.approvals.filter((item) => item.id !== id)
        resolve(
          allowed
            ? { behavior: 'allow', updatedInput: input }
            : { behavior: 'deny', message: '用户拒绝本次操作' }
        )
        if (this.run === run) this.emit(run.session)
      }
      const abort = (): void => settle(false)
      this.approvals.set(id, { run, settle })
      signal.addEventListener('abort', abort, { once: true })
      run.session.approvals.push({
        id,
        title: `Claude 请求使用 ${name.slice(0, 100)}`,
        details: acpPreview(input, 'Claude Code'),
        canAllow: true
      })
      this.emit(run.session)
    })
  }
  private resolveApprovals(run: ClaudeRun): void {
    for (const item of [...this.approvals.values()]) if (item.run === run) item.settle(false)
  }

  private async consume(run: ClaudeRun): Promise<void> {
    const session = run.session
    try {
      for await (const value of run.query) {
        if (this.run !== run) break
        const message = object(value)
        if (!message || message.parent_tool_use_id) continue
        if (typeof message.session_id === 'string' && message.session_id !== session.id)
          throw new CodingAgentError('Claude 返回了不同会话，已停止以保护草稿归属')
        if (message.type === 'system' && message.subtype === 'init') {
          this.persisted.add(session.id)
          this.commandLists.set(
            session.id,
            nativeCommands(
              Array.isArray(message.slash_commands)
                ? message.slash_commands
                    .filter(
                      (name: unknown) =>
                        typeof name === 'string' &&
                        !(
                          Array.isArray(message.terminal_slash_commands) &&
                          message.terminal_slash_commands.includes(name)
                        )
                    )
                    .map((name: string) => ({ name }))
                : []
            )
          )
        }
        if (message.type === 'system' && message.subtype === 'compact_boundary') {
          session.tools.push({
            id: randomUUID(),
            title: '原生上下文压缩已完成',
            status: 'completed'
          })
        }
        // 压缩的摘要保留在原生日志；显示缓存已满时仍消费控制与终态，避免误停压缩。
        if (run.compacting && (message.type === 'assistant' || message.type === 'stream_event'))
          continue
        if (
          message.type === 'system' &&
          (message.subtype === 'init' || message.subtype === 'status') &&
          typeof message.permissionMode === 'string'
        ) {
          const mode = CLAUDE_PERMISSION_OPTIONS.find(
            (item) => item.value === message.permissionMode
          )
          if (!mode) throw new CodingAgentError('原生程序返回了未支持的操作模式，已停止任务')
          const option = session.options.find((item) => item.id === 'permission')
          if (option && option.currentValue !== mode.value) {
            option.currentValue = mode.value
            session.error = `原生程序当前使用${mode.label}；所选模式未生效，请核对模型、供应商或原生策略`
          }
        }
        if (message.type === 'stream_event') {
          const event = object(message.event)
          if (event?.type === 'message_start')
            run.messageId = text(object(event.message)?.id) || randomUUID()
          const delta = object(event?.delta)
          if (event?.type === 'content_block_delta' && delta?.type === 'text_delta') {
            if (!run.messageId) run.messageId = randomUUID()
            const existing = session.messages.find((item) => item.id === run.messageId)
            if (existing)
              existing.content = (existing.content + text(delta.text, 200_000)).slice(0, 200_000)
            else
              session.messages.push({
                id: run.messageId,
                role: 'assistant',
                content: text(delta.text, 200_000)
              })
          }
        } else if (message.type === 'assistant') {
          const body = object(message.message)
          const id = text(body?.id) || run.messageId || randomUUID()
          const content = this.messageText(body?.content)
          const existing = session.messages.find((item) => item.id === id)
          if (existing) existing.content = content
          else if (content) session.messages.push({ id, role: 'assistant', content })
          if (Array.isArray(body?.content))
            for (const raw of body.content) {
              const block = object(raw)
              if (block?.type === 'tool_use')
                session.tools.push({
                  id: text(block.id),
                  title: text(block.name),
                  status: 'running'
                })
            }
        } else if (message.type === 'user') {
          const body = object(message.message)
          if (Array.isArray(body?.content))
            for (const raw of body.content) {
              const block = object(raw)
              const tool = session.tools.find((item) => item.id === block?.tool_use_id)
              if (block?.type === 'tool_result' && tool)
                tool.status = block.is_error ? 'failed' : 'completed'
            }
        } else if (message.type === 'result') {
          run.completed = true
          session.status =
            message.subtype === 'success' && message.is_error !== true ? 'ready' : 'error'
          session.outcome = session.status === 'ready' ? 'completed' : 'failed'
          if (session.status === 'error')
            session.error =
              'Claude 任务失败，请检查当前 Claude / CC Switch 的路由、认证、模型或执行限制；未自动重发'
          break
        }
        if (
          session.messages.length > 200 ||
          session.messages.reduce((total, message) => total + message.content.length, 0) > 200_000
        )
          throw new CodingAgentError('会话达到显示上限，已停止任务，请在原生客户端核对后继续')
        if (session.tools.length > 100) session.tools = session.tools.slice(-100)
        this.emit(session, false)
      }
      if (!run.completed && this.run === run) {
        session.status = 'error'
        session.outcome = 'unknown'
        session.error = 'Claude 未返回完成状态，请核对原生会话后继续'
      }
    } catch (error) {
      if (this.run === run && !run.stopped) {
        session.status = 'error'
        session.outcome = 'unknown'
        session.error =
          error instanceof CodingAgentError
            ? error.message
            : 'Claude 运行中断，请检查官方认证与程序；未自动重发'
      }
    } finally {
      clearTimeout(run.timer)
      this.resolveApprovals(run)
      run.closeInput()
      run.query.close()
      if (this.run === run) {
        this.run = null
        this.emit(session)
      }
    }
  }
}
