import { contextBridge, ipcRenderer } from 'electron'

import { CHAT_EVENT, IPC } from '../shared/ipc-contract'
import type {
  AiConfigInput,
  ChatCompletedEvent,
  ChatDeltaEvent,
  ChatErrorEvent,
  ChatSendRequest,
  ChatStoppedEvent,
  NoteSaveInput,
  PasswordInput,
  ReadingProgressInput
} from '../shared/types'
import type { ToolboxBridge } from '../shared/bridge'

function subscribe<T>(
  channel: string,
  listener: (payload: T) => void
): () => void {
  const wrapped = (_event: unknown, payload: T): void => {
    listener(payload)
  }
  ipcRenderer.on(channel, wrapped)
  return () => {
    ipcRenderer.removeListener(channel, wrapped)
  }
}

const bridge: ToolboxBridge = {
  settings: {
    get: () => ipcRenderer.invoke(IPC.settingsGet),
    save: (input: AiConfigInput) => ipcRenderer.invoke(IPC.settingsSave, input)
  },
  chat: {
    listConversations: () => ipcRenderer.invoke(IPC.conversationList),
    createConversation: () => ipcRenderer.invoke(IPC.conversationCreate),
    renameConversation: (id: string, title: string) =>
      ipcRenderer.invoke(IPC.conversationRename, id, title),
    deleteConversation: (id: string) =>
      ipcRenderer.invoke(IPC.conversationDelete, id),
    listMessages: (conversationId: string) =>
      ipcRenderer.invoke(IPC.messageList, conversationId),
    send: (request: ChatSendRequest) => ipcRenderer.invoke(IPC.chatSend, request),
    stop: (conversationId: string) =>
      ipcRenderer.invoke(IPC.chatStop, conversationId),
    onDelta: (listener: (event: ChatDeltaEvent) => void) =>
      subscribe<ChatDeltaEvent>(CHAT_EVENT.delta, listener),
    onCompleted: (listener: (event: ChatCompletedEvent) => void) =>
      subscribe<ChatCompletedEvent>(CHAT_EVENT.completed, listener),
    onError: (listener: (event: ChatErrorEvent) => void) =>
      subscribe<ChatErrorEvent>(CHAT_EVENT.error, listener),
    onStopped: (listener: (event: ChatStoppedEvent) => void) =>
      subscribe<ChatStoppedEvent>(CHAT_EVENT.stopped, listener)
  },
  books: {
    list: () => ipcRenderer.invoke(IPC.booksList),
    import: () => ipcRenderer.invoke(IPC.booksImport),
    listChapters: (bookId: string) => ipcRenderer.invoke(IPC.booksChapters, bookId),
    chapterContent: (chapterId: string) =>
      ipcRenderer.invoke(IPC.booksChapterContent, chapterId),
    progressGet: (bookId: string) => ipcRenderer.invoke(IPC.booksProgressGet, bookId),
    progressSave: (bookId: string, chapterIdx: number, offsetRatio: number) =>
      ipcRenderer.invoke(IPC.booksProgressSave, {
        bookId,
        chapterIdx,
        offsetRatio
      } satisfies ReadingProgressInput),
    delete: (bookId: string) => ipcRenderer.invoke(IPC.booksDelete, bookId)
  },
  passwords: {
    list: () => ipcRenderer.invoke(IPC.passwordList),
    save: (input: PasswordInput & { id?: string }) =>
      ipcRenderer.invoke(IPC.passwordSave, input),
    delete: (id: string) => ipcRenderer.invoke(IPC.passwordDelete, id),
    setFavorite: (id: string, isFavorite: boolean) =>
      ipcRenderer.invoke(IPC.passwordSetFavorite, id, isFavorite),
    import: () => ipcRenderer.invoke(IPC.passwordImport)
  },
  notes: {
    list: () => ipcRenderer.invoke(IPC.notesList),
    save: (input: NoteSaveInput) => ipcRenderer.invoke(IPC.notesSave, input),
    delete: (id: string) => ipcRenderer.invoke(IPC.notesDelete, id),
    import: () => ipcRenderer.invoke(IPC.notesImport),
    export: (id: string) => ipcRenderer.invoke(IPC.notesExport, id)
  },
  system: {
    copyText: (text: string) => ipcRenderer.invoke(IPC.systemCopy, text)
  }
}

contextBridge.exposeInMainWorld('toolbox', bridge)
