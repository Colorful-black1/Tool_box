import { contextBridge, ipcRenderer } from 'electron'

import { CHAT_EVENT, IPC } from '../shared/ipc-contract'
import type {
  AgentPermission,
  AgentToolApprovalInput,
  AgentToolApprovalRequestEvent,
  AgentToolCallEvent,
  AgentToolResultEvent,
  AiFetchModelsInput,
  AiProfileInput,
  ChatCompletedEvent,
  ChatDeltaEvent,
  ChatErrorEvent,
  ChatSendRequest,
  ChatStoppedEvent,
  NoteSaveInput,
  PasswordDraft,
  PasswordInput,
  ReadingProgressInput
} from '../shared/types'
import type { ToolboxBridge } from '../shared/bridge'

function subscribe<T>(channel: string, listener: (payload: T) => void): () => void {
  const wrapped = (_event: unknown, payload: T): void => {
    listener(payload)
  }
  ipcRenderer.on(channel, wrapped)
  return () => {
    ipcRenderer.removeListener(channel, wrapped)
  }
}

const bridge: ToolboxBridge = {
  app: {
    info: () => ipcRenderer.invoke(IPC.appInfo)
  },
  settings: {
    get: () => ipcRenderer.invoke(IPC.settingsGet),
    save: (input: AiProfileInput) => ipcRenderer.invoke(IPC.settingsSave, input),
    remove: (id: string) => ipcRenderer.invoke(IPC.settingsRemove, id),
    activate: (id: string) => ipcRenderer.invoke(IPC.settingsActivate, id),
    fetchModels: (input: AiFetchModelsInput) =>
      ipcRenderer.invoke(IPC.settingsModelsFetch, input)
  },
  config: {
    get: () => ipcRenderer.invoke(IPC.configGet),
    set: (patch: Record<string, unknown>) => ipcRenderer.invoke(IPC.configSet, patch)
  },
  chat: {
    listConversations: () => ipcRenderer.invoke(IPC.conversationList),
    createConversation: () => ipcRenderer.invoke(IPC.conversationCreate),
    renameConversation: (id: string, title: string) =>
      ipcRenderer.invoke(IPC.conversationRename, id, title),
    deleteConversation: (id: string) => ipcRenderer.invoke(IPC.conversationDelete, id),
    listMessages: (conversationId: string) => ipcRenderer.invoke(IPC.messageList, conversationId),
    send: (request: ChatSendRequest) => ipcRenderer.invoke(IPC.chatSend, request),
    stop: (conversationId: string) => ipcRenderer.invoke(IPC.chatStop, conversationId),
    onDelta: (listener: (event: ChatDeltaEvent) => void) =>
      subscribe<ChatDeltaEvent>(CHAT_EVENT.delta, listener),
    onCompleted: (listener: (event: ChatCompletedEvent) => void) =>
      subscribe<ChatCompletedEvent>(CHAT_EVENT.completed, listener),
    onError: (listener: (event: ChatErrorEvent) => void) =>
      subscribe<ChatErrorEvent>(CHAT_EVENT.error, listener),
    onStopped: (listener: (event: ChatStoppedEvent) => void) =>
      subscribe<ChatStoppedEvent>(CHAT_EVENT.stopped, listener),
    onToolCall: (listener: (event: AgentToolCallEvent) => void) =>
      subscribe<AgentToolCallEvent>(CHAT_EVENT.toolCall, listener),
    onToolResult: (listener: (event: AgentToolResultEvent) => void) =>
      subscribe<AgentToolResultEvent>(CHAT_EVENT.toolResult, listener),
    onToolApprovalRequest: (listener: (event: AgentToolApprovalRequestEvent) => void) =>
      subscribe<AgentToolApprovalRequestEvent>(CHAT_EVENT.toolApproval, listener),
    approveTool: (input: AgentToolApprovalInput) =>
      ipcRenderer.invoke(IPC.chatToolApproval, input)
  },
  agent: {
    getPermission: () => ipcRenderer.invoke(IPC.agentPermissionGet),
    setPermission: (permission: AgentPermission) =>
      ipcRenderer.invoke(IPC.agentPermissionSet, permission)
  },
  books: {
    list: () => ipcRenderer.invoke(IPC.booksList),
    search: (query: string) => ipcRenderer.invoke(IPC.booksSearch, query),
    import: () => ipcRenderer.invoke(IPC.booksImport),
    listChapters: (bookId: string) => ipcRenderer.invoke(IPC.booksChapters, bookId),
    chapterContent: (chapterId: string) =>
      ipcRenderer.invoke(IPC.booksChapterContent, chapterId),
    progressGet: (bookId: string) => ipcRenderer.invoke(IPC.booksProgressGet, bookId),
    progressSave: (input: ReadingProgressInput) =>
      ipcRenderer.invoke(IPC.booksProgressSave, input),
    delete: (bookId: string) => ipcRenderer.invoke(IPC.booksDelete, bookId),
    reorder: (orderedIds: string[]) => ipcRenderer.invoke(IPC.booksReorder, orderedIds),
    updateMeta: (id: string, meta: { title?: string; author?: string }) =>
      ipcRenderer.invoke(IPC.booksUpdateMeta, id, meta),
    setCover: (id: string) => ipcRenderer.invoke(IPC.booksSetCover, id),
    setGroup: (ids: string[], groupId: string | null) =>
      ipcRenderer.invoke(IPC.booksSetGroup, ids, groupId)
  },
  groups: {
    list: () => ipcRenderer.invoke(IPC.groupsList),
    create: (name: string) => ipcRenderer.invoke(IPC.groupsCreate, name),
    rename: (id: string, name: string) => ipcRenderer.invoke(IPC.groupsRename, id, name),
    delete: (id: string) => ipcRenderer.invoke(IPC.groupsDelete, id)
  },
  bookmarks: {
    list: (bookId: string) => ipcRenderer.invoke(IPC.bookmarksList, bookId),
    toggle: (input: {
      bookId: string
      chapterIdx: number
      pageIdx: number
      pageIdxRatio: number
      snippet: string
    }) => ipcRenderer.invoke(IPC.bookmarksToggle, input),
    delete: (id: string) => ipcRenderer.invoke(IPC.bookmarksDelete, id)
  },
  stats: {
    summary: () => ipcRenderer.invoke(IPC.statsSummary),
    flush: (input: { durationMs: number; charCount: number }) =>
      ipcRenderer.invoke(IPC.statsFlush, input)
  },
  passwords: {
    list: () => ipcRenderer.invoke(IPC.passwordList),
    save: (input: PasswordInput & { id?: string }) =>
      ipcRenderer.invoke(IPC.passwordSave, input),
    delete: (id: string) => ipcRenderer.invoke(IPC.passwordDelete, id),
    setFavorite: (id: string, isFavorite: boolean) =>
      ipcRenderer.invoke(IPC.passwordSetFavorite, id, isFavorite),
    importFixed: () => ipcRenderer.invoke(IPC.passwordImportFixed),
    importAi: () => ipcRenderer.invoke(IPC.passwordImportAi),
    importSave: (drafts: PasswordDraft[]) =>
      ipcRenderer.invoke(IPC.passwordImportSave, drafts)
  },
  notes: {
    list: () => ipcRenderer.invoke(IPC.notesList),
    save: (input: NoteSaveInput) => ipcRenderer.invoke(IPC.notesSave, input),
    delete: (id: string) => ipcRenderer.invoke(IPC.notesDelete, id),
    import: () => ipcRenderer.invoke(IPC.notesImport),
    export: (id: string) => ipcRenderer.invoke(IPC.notesExport, id)
  },
  background: {
    pick: () => ipcRenderer.invoke(IPC.backgroundPick),
    clear: () => ipcRenderer.invoke(IPC.backgroundClear)
  },
  system: {
    copyText: (text: string) => ipcRenderer.invoke(IPC.systemCopy, text)
  }
}

contextBridge.exposeInMainWorld('toolbox', bridge)