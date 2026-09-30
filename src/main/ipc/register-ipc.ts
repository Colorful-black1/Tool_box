import { BrowserWindow, clipboard, dialog, ipcMain } from 'electron'

import { CHAT_EVENT, IPC } from '../../shared/ipc-contract'
import type {
  AiConfigInput,
  ChatSendRequest,
  NoteSaveInput,
  PasswordInput,
  ReadingProgressInput
} from '../../shared/types'
import type { AiGateway, ChatEventSink } from '../services/ai-gateway/ai-gateway'
import type { ImportService } from '../services/library/import-service'
import type { ToolboxStore } from '../services/chat-store/chat-store'
import type { SettingsService } from '../services/settings/settings-service'
import { parsePasswordText } from '../services/library/password-text-parser'
import { requireString } from './validation'

export interface IpcDependencies {
  settings: SettingsService
  store: ToolboxStore
  aiGateway: AiGateway
  importService: ImportService
}

export function registerIpcHandlers(dependencies: IpcDependencies): void {
  const { settings, store, aiGateway, importService } = dependencies

  // ---------- 设置 ----------
  ipcMain.handle(IPC.settingsGet, () => settings.getView())

  ipcMain.handle(IPC.settingsSave, (_event, input: AiConfigInput) => {
    if (typeof input !== 'object' || input === null) throw new Error('设置内容无效')
    return settings.save(input)
  })

  // ---------- AI 对话 ----------
  ipcMain.handle(IPC.conversationList, () => store.listConversations())
  ipcMain.handle(IPC.conversationCreate, () => store.createConversation())

  ipcMain.handle(IPC.conversationRename, (_event, id: unknown, title: unknown) => {
    const conversationId = requireString(id, '会话 ID')
    const safeTitle = requireString(title, '会话标题', { maxLength: 60 })
    return store.renameConversation(conversationId, safeTitle)
  })

  ipcMain.handle(IPC.conversationDelete, (_event, id: unknown) => {
    store.deleteConversation(requireString(id, '会话 ID'))
  })

  ipcMain.handle(IPC.messageList, (_event, id: unknown) => {
    return store.listMessages(requireString(id, '会话 ID'))
  })

  ipcMain.handle(IPC.chatSend, (event, request: ChatSendRequest) => {
    if (typeof request !== 'object' || request === null) throw new Error('请求内容无效')
    const conversationId = requireString(request.conversationId, '会话 ID')
    const content = requireString(request.content, '消息内容')
    return aiGateway.send({ conversationId, content }, createChatEventSink(event.sender))
  })

  ipcMain.handle(IPC.chatStop, (_event, id: unknown) => {
    aiGateway.stop(requireString(id, '会话 ID'))
  })

  // ---------- 小说书库 ----------
  ipcMain.handle(IPC.booksList, () => store.listBooks())

  ipcMain.handle(IPC.booksImport, async () => {
    const filePath = await pickTextFile()
    if (!filePath) return null
    const parsed = importService.parse(filePath)
    return store.importBook({
      title: parsed.title,
      chapters: parsed.chapters
    })
  })

  ipcMain.handle(IPC.booksChapters, (_event, bookId: unknown) => {
    return store.listChapters(requireString(bookId, '书籍 ID'))
  })

  ipcMain.handle(IPC.booksChapterContent, (_event, chapterId: unknown) => {
    return store.chapterContent(requireString(chapterId, '章节 ID'))
  })

  ipcMain.handle(IPC.booksProgressGet, (_event, bookId: unknown) => {
    return store.progressGet(requireString(bookId, '书籍 ID'))
  })

  ipcMain.handle(IPC.booksProgressSave, (_event, input: ReadingProgressInput) => {
    assertObject(input, '进度数据')
    const bookId = requireString(input.bookId, '书籍 ID')
    if (typeof input.chapterIdx !== 'number' || !Number.isInteger(input.chapterIdx)) {
      throw new Error('章节序号无效')
    }
    if (typeof input.offsetRatio !== 'number' || Number.isNaN(input.offsetRatio)) {
      throw new Error('进度比例无效')
    }
    store.progressSave({
      bookId,
      chapterIdx: input.chapterIdx,
      offsetRatio: input.offsetRatio
    })
  })

  ipcMain.handle(IPC.booksDelete, (_event, bookId: unknown) => {
    store.deleteBook(requireString(bookId, '书籍 ID'))
  })

  // ---------- 密码箱 ----------
  ipcMain.handle(IPC.passwordList, () => store.listPasswords())

  ipcMain.handle(IPC.passwordSave, (_event, input: PasswordInput & { id?: string }) => {
    assertObject(input, '密码条目')
    const title = requireString(input.title, '名称')
    requireString(input.account, '账号', { allowEmpty: true })
    requireString(input.password ?? '', '密码', { allowEmpty: true })
    store.savePassword({
      id: input.id,
      title,
      url: typeof input.url === 'string' ? input.url.trim() : '',
      account: typeof input.account === 'string' ? input.account.trim() : '',
      password: typeof input.password === 'string' ? input.password : '',
      remark: typeof input.remark === 'string' ? input.remark : '',
      isFavorite: input.isFavorite
    })
  })

  ipcMain.handle(IPC.passwordDelete, (_event, id: unknown) => {
    store.deletePassword(requireString(id, '条目 ID'))
  })

  ipcMain.handle(
    IPC.passwordSetFavorite,
    (_event, id: unknown, isFavorite: unknown) => {
      store.setPasswordFavorite(
        requireString(id, '条目 ID'),
        isFavorite === true
      )
    }
  )

  ipcMain.handle(IPC.passwordImport, async () => {
    const filePath = await pickTextFile()
    if (!filePath) return null
    const { readFileSync } = await import('node:fs')
    const text = readFileSync(filePath, 'utf8')
    const { entries, skipped } = parsePasswordText(text)
    for (const entry of entries) {
      store.savePassword({
        title: entry.title || entry.account || '未命名',
        url: entry.url,
        account: entry.account,
        password: entry.password,
        remark: entry.remark
      })
    }
    return { imported: entries.length, skipped }
  })

  // ---------- 记事本 ----------
  ipcMain.handle(IPC.notesList, () => store.listNotes())

  ipcMain.handle(IPC.notesSave, (_event, input: NoteSaveInput) => {
    assertObject(input, '笔记内容')
    return store.saveNote({
      id: input.id,
      title: requireString(input.title, '笔记标题', { allowEmpty: true, maxLength: 60 }),
      content: requireString(input.content, '笔记内容', { allowEmpty: true })
    })
  })

  ipcMain.handle(IPC.notesDelete, (_event, id: unknown) => {
    store.deleteNote(requireString(id, '笔记 ID'))
  })

  ipcMain.handle(IPC.notesImport, async () => {
    const filePath = await pickTextFile(['md', 'markdown', 'txt'])
    if (!filePath) return null
    const { readFileSync } = await import('node:fs')
    const content = readFileSync(filePath, 'utf8')
    const title = filePath
      .replaceAll('\\', '/')
      .split('/')
      .pop()!
      .replace(/\.[^.]+$/, '')
    return store.saveNote({ title, content })
  })

  ipcMain.handle(IPC.notesExport, async (_event, id: unknown) => {
    const noteId = requireString(id, '笔记 ID')
    const note = store.listNotes().find((item) => item.id === noteId)
    if (!note) throw new Error('笔记不存在')
    const targetPath = await saveMarkdownFile(
      `${note.title || '无标题'}.md`,
      note.content
    )
    return targetPath
  })

  // ---------- 系统 ----------
  ipcMain.handle(IPC.systemCopy, (_event, text: unknown) => {
    const content = requireString(text, '复制内容', { allowEmpty: true })
    clipboard.writeText(content)
  })
}

function assertObject(value: unknown, name: string): void {
  if (typeof value !== 'object' || value === null) throw new Error(`${name}无效`)
}

function createChatEventSink(sender: import('electron').WebContents): ChatEventSink {
  const send = <T>(channel: string, payload: T): void => {
    if (!sender.isDestroyed()) sender.send(channel, payload)
  }
  return {
    onDelta: (event) => send(CHAT_EVENT.delta, event),
    onCompleted: (event) => send(CHAT_EVENT.completed, event),
    onError: (event) => send(CHAT_EVENT.error, event),
    onStopped: (event) => send(CHAT_EVENT.stopped, event)
  }
}

async function pickTextFile(extensions: string[] = ['txt']): Promise<string | null> {
  const window = BrowserWindow.getAllWindows()[0]
  const result = await dialog.showOpenDialog({
    title: '选择文件',
    properties: ['openFile'],
    filters: [{ name: '支持的文件', extensions }],
    ...(window ? { window } : {})
  })
  if (result.canceled || result.filePaths.length === 0) return null
  return result.filePaths[0]
}

async function saveMarkdownFile(
  defaultName: string,
  content: string
): Promise<string | null> {
  const window = BrowserWindow.getAllWindows()[0]
  const result = await dialog.showSaveDialog({
    title: '导出笔记',
    defaultPath: defaultName,
    filters: [{ name: 'Markdown', extensions: ['md'] }],
    ...(window ? { window } : {})
  })
  if (result.canceled || !result.filePath) return null
  const { writeFileSync } = await import('node:fs')
  writeFileSync(result.filePath, content, 'utf8')
  return result.filePath
}
