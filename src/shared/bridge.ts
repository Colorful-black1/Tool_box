import type {
  AiOutputEvent,
  AgentPermission,
  AgentToolApprovalInput,
  AgentToolApprovalRequestEvent,
  AgentToolCallEvent,
  AgentToolResultEvent,
  AiConfigView,
  AiFetchModelsInput,
  AiModelListResult,
  AiProfileInput,
  AppInfo,
  BookGroup,
  BookSummary,
  Bookmark,
  ChapterContent,
  ChapterMeta,
  ChatCompletedEvent,
  ChatDeltaEvent,
  ChatErrorEvent,
  ChatMessage,
  ChatSendRequest,
  ChatSendResult,
  ChatStoppedEvent,
  ConversationSummary,
  ImportResult,
  LocalIpAddressView,
  PortSnapshot,
  CertificateView,
  NoteSaveInput,
  NoteView,
  OpenCodeEvent,
  OpenCodeInfo,
  OpenCodeSession,
  OpenCodeSessionSummary,
  PasswordDraft,
  PasswordEntryView,
  PasswordInput,
  ReadingProgressInput,
  ShortcutConfig,
  ShortcutSetResult,
  StatsSummary,
  TodoInput,
  TodoView,
  TodoQuery,
  TodoSnapshot,
  TodoEvent
} from './types'
import type {
  CodingAgentId,
  CodingAgentEvent,
  CodingAgentRuntimeView,
  CodingAgentSessionView,
  CodingAgentSessionSummary,
  CodingAgentSessionInput
} from './coding-agents'
import type { UsageClient, UsageQuery, UsageReport } from './agent-usage'
import type { AgentDraftSnapshot, AgentDraftSaveInput } from './agent-drafts'

export interface ToolboxBridge {
  todos: {
    list(query: TodoQuery): Promise<TodoSnapshot>
    save(input: TodoInput): Promise<TodoView>
    complete(id: string, completed: boolean): Promise<void>
    archive(id: string, archived: boolean): Promise<void>
    testNotification(): Promise<void>
    onEvent(listener: (event: TodoEvent) => void): () => void
  }
  agentDrafts: {
    read(): Promise<AgentDraftSnapshot>
    save(input: AgentDraftSaveInput): Promise<AgentDraftSnapshot>
    onFlush(listener: (requestId: string) => void): () => void
    flushed(input: { requestId: string; saved: boolean }): Promise<void>
  }
  agentUsage: {
    query(input: UsageQuery): Promise<UsageReport>
    chooseSource(client: UsageClient): Promise<boolean>
    resetSource(client: UsageClient): Promise<void>
  }
  codingAgents: {
    listRuntimes(): Promise<CodingAgentRuntimeView[]>
    inspect(runtimeId: CodingAgentId): Promise<CodingAgentRuntimeView>
    chooseExecutable(runtimeId: CodingAgentId): Promise<CodingAgentRuntimeView | null>
    chooseDirectory(): Promise<string | null>
    connect(input: { runtimeId: CodingAgentId; directory: string }): Promise<CodingAgentRuntimeView>
    disconnect(runtimeId: CodingAgentId): Promise<void>
    listSessions(runtimeId: CodingAgentId): Promise<CodingAgentSessionSummary[]>
    createSession(runtimeId: CodingAgentId): Promise<CodingAgentSessionView>
    resumeSession(input: CodingAgentSessionInput): Promise<CodingAgentSessionView>
    setOption(
      input: CodingAgentSessionInput & { optionId: string; value: string }
    ): Promise<CodingAgentSessionView>
    send(input: CodingAgentSessionInput & { content: string }): Promise<void>
    stop(input: CodingAgentSessionInput): Promise<void>
    approve(
      input: CodingAgentSessionInput & { approvalId: string; approved: boolean }
    ): Promise<void>
    openDesktop(runtimeId: CodingAgentId): Promise<void>
    onEvent(listener: (event: CodingAgentEvent) => void): () => void
  }
  tools: {
    inspectCertificate(text: string): Promise<CertificateView[]>
    /** 手动润色；通过 requestId 关联增量，返回最终校验结果，不执行任务或保存会话。 */
    polishPrompt(text: string, requestId?: string): Promise<string>
    stopAi(requestId: string): Promise<void>
    onAiOutput(listener: (event: AiOutputEvent) => void): () => void
  }
  opencode: {
    /** 已连接时同步 Desktop 模型可见性；不创建或恢复会话。 */
    inspect(): Promise<OpenCodeInfo>
    chooseExecutable(): Promise<OpenCodeInfo | null>
    chooseDirectory(): Promise<string | null>
    connect(directory: string): Promise<OpenCodeInfo>
    disconnect(): Promise<void>
    listSessions(): Promise<OpenCodeSessionSummary[]>
    openSession(id?: string): Promise<OpenCodeSession>
    setOption(input: {
      sessionId: string
      optionId: string
      value: string
    }): Promise<OpenCodeSession>
    send(input: { sessionId: string; content: string }): Promise<void>
    stop(sessionId: string): Promise<void>
    approve(input: { sessionId: string; approvalId: string; approved: boolean }): Promise<void>
    openDesktop(): Promise<void>
    onEvent(listener: (event: OpenCodeEvent) => void): () => void
  }
  app: {
    info(): Promise<AppInfo>
  }
  settings: {
    /** 全部档案 + 当前启用档案 */
    get(): Promise<AiConfigView>
    /** 新建或更新档案（id 留空为新建），返回最新视图 */
    save(input: AiProfileInput): Promise<AiConfigView>
    remove(id: string): Promise<AiConfigView>
    /** 切换启用档案 */
    activate(id: string): Promise<AiConfigView>
    /** 拉取供应商模型列表；apiKey 留空时用档案已保存的 Key */
    fetchModels(input: AiFetchModelsInput): Promise<AiModelListResult>
  }
  config: {
    get(): Promise<Record<string, unknown> | null>
    set(patch: Record<string, unknown>): Promise<Record<string, unknown> | null>
  }
  chat: {
    listConversations(): Promise<ConversationSummary[]>
    createConversation(): Promise<ConversationSummary>
    renameConversation(id: string, title: string): Promise<ConversationSummary>
    deleteConversation(id: string): Promise<void>
    listMessages(conversationId: string): Promise<ChatMessage[]>
    send(request: ChatSendRequest): Promise<ChatSendResult>
    stop(conversationId: string): Promise<void>
    onDelta(listener: (event: ChatDeltaEvent) => void): () => void
    onCompleted(listener: (event: ChatCompletedEvent) => void): () => void
    onError(listener: (event: ChatErrorEvent) => void): () => void
    onStopped(listener: (event: ChatStoppedEvent) => void): () => void
    onToolCall(listener: (event: AgentToolCallEvent) => void): () => void
    onToolResult(listener: (event: AgentToolResultEvent) => void): () => void
    onToolApprovalRequest(listener: (event: AgentToolApprovalRequestEvent) => void): () => void
    /** 批准 / 拒绝一次写或破坏性工具调用 */
    approveTool(input: AgentToolApprovalInput): Promise<void>
  }
  agent: {
    /** 当前 Agent 权限档位 */
    getPermission(): Promise<AgentPermission>
    setPermission(permission: AgentPermission): Promise<AgentPermission>
  }
  books: {
    list(): Promise<BookSummary[]>
    search(query: string): Promise<BookSummary[]>
    import(): Promise<BookSummary | null>
    listChapters(bookId: string): Promise<ChapterMeta[]>
    chapterContent(chapterId: string): Promise<ChapterContent>
    progressGet(bookId: string): Promise<{ chapterIdx: number; percent: number } | null>
    progressSave(input: ReadingProgressInput): Promise<void>
    delete(bookId: string): Promise<void>
    reorder(orderedIds: string[]): Promise<void>
    updateMeta(
      id: string,
      meta: { title?: string; author?: string }
    ): Promise<BookSummary>
    /** 主进程弹出图片选择框并复制到受管目录；取消时静默返回 */
    setCover(id: string): Promise<void>
    setGroup(ids: string[], groupId: string | null): Promise<void>
  }
  groups: {
    list(): Promise<BookGroup[]>
    create(name: string): Promise<BookGroup>
    rename(id: string, name: string): Promise<void>
    delete(id: string): Promise<void>
  }
  bookmarks: {
    list(bookId: string): Promise<Bookmark[]>
    toggle(input: {
      bookId: string
      chapterIdx: number
      pageIdx: number
      pageIdxRatio: number
      snippet: string
    }): Promise<{ active: boolean }>
    delete(id: string): Promise<void>
  }
  stats: {
    summary(): Promise<StatsSummary>
    flush(input: { durationMs: number; charCount: number }): Promise<void>
  }
  passwords: {
    list(): Promise<PasswordEntryView[]>
    save(input: PasswordInput & { id?: string }): Promise<void>
    delete(id: string): Promise<void>
    setFavorite(id: string, isFavorite: boolean): Promise<void>
    importFixed(): Promise<ImportResult | null>
    importAi(requestId?: string): Promise<PasswordDraft[] | null>
    importSave(drafts: PasswordDraft[]): Promise<number>
  }
  notes: {
    list(): Promise<NoteView[]>
    save(input: NoteSaveInput): Promise<NoteView>
    delete(id: string): Promise<void>
    import(): Promise<NoteView | null>
    export(id: string): Promise<string | null>
  }
  background: {
    pick(): Promise<string | null>
    clear(): Promise<void>
  }
  system: {
    /** 本机非回环网卡地址，不发起公网请求。 */
    networkAddresses(): Promise<LocalIpAddressView[]>
    portProcesses(): Promise<PortSnapshot>
    copyText(text: string): Promise<void>
    /** 读取全局快捷键配置 */
    getShortcut(): Promise<ShortcutConfig>
    /** 修改全局快捷键配置（会立刻生效） */
    setShortcut(config: ShortcutConfig): Promise<ShortcutSetResult>
  }
}
