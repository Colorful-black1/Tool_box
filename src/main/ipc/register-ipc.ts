import { BrowserWindow, clipboard, dialog, ipcMain, app } from 'electron'
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, extname, join } from 'node:path'

import { BACKGROUNDS_DIR, COVERS_DIR } from '../../shared/constants'
import { CHAT_EVENT, IPC } from '../../shared/ipc-contract'
import type {
  AiConfigInput,
  ChatSendRequest,
  NoteSaveInput,
  PasswordDraft,
  PasswordInput,
  ReadingProgressInput
} from '../../shared/types'
import type { AiGateway, ChatEventSink } from '../services/ai-gateway/ai-gateway'
import type { ToolboxStore } from '../services/chat-store/chat-store'
import type { ImportService } from '../services/library/import-service'
import { parsePasswordText } from '../services/library/password-text-parser'
import { PasswordAiService } from '../services/password/password-ai-service'
import type { SettingsService } from '../services/settings/settings-service'
import {
  assertObject,
  requireNonNegativeInt,
  requireRatio,
  requireString,
  requireStringArray
} from './validation'

export interface IpcDependencies {
  settings: SettingsService
  store: ToolboxStore
  aiGateway: AiGateway
  importService: ImportService
  passwordAi: PasswordAiService
}

export function registerIpcHandlers(dependencies: IpcDependencies): void {
  const { settings, store, aiGateway, importService, passwordAi } = dependencies
  const assetsDir = app.getAppPath()
  const userDataDir = app.getPath('userData')

  // ---------- 应用信息 ----------
  ipcMain.handle(IPC.appInfo, () => ({
    name: app.getName(),
    version: app.getVersion(),
    platform: process.platform
  }))

  // ---------- 阅读配置 kv ----------
  ipcMain.handle(IPC.configGet, () => store.configGet())
  ipcMain.handle(IPC.configSet, (_event, patch: unknown) => {
    return store.configSet(assertObject(patch, '配置'))
  })

  // ---------- AI 配置 ----------
  ipcMain.handle(IPC.settingsGet, () => settings.getView())
  ipcMain.handle(IPC.settingsSave, (_event, input: unknown) => {
    return settings.save(assertObject(input, '设置内容') as unknown as AiConfigInput)
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
    const body = assertObject(request, '请求内容') as unknown as ChatSendRequest
    const conversationId = requireString(body.conversationId, '会话 ID')
    const content = requireString(body.content, '消息内容')
    return aiGateway.send({ conversationId, content }, createChatEventSink(event.sender))
  })

  ipcMain.handle(IPC.chatStop, (_event, id: unknown) => {
    aiGateway.stop(requireString(id, '会话 ID'))
  })

  // ---------- 小说 ----------
  ipcMain.handle(IPC.booksList, () => store.listBooks())
  ipcMain.handle(IPC.booksSearch, (_event, query: unknown) => {
    return store.listBooks(requireString(query, '搜索词', { allowEmpty: true }))
  })

  ipcMain.handle(IPC.booksImport, async () => {
    const filePath = await pickFile(['txt'])
    if (!filePath) return null
    const parsed = importService.parse(filePath)
    return store.importBook({
      title: parsed.title,
      author: '',
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

  ipcMain.handle(IPC.booksProgressSave, (_event, input: unknown) => {
    const body = assertObject(input, '进度数据') as unknown as ReadingProgressInput
    store.progressSave({
      bookId: requireString(body.bookId, '书籍 ID'),
      chapterIdx: requireNonNegativeInt(body.chapterIdx, '章节序号'),
      percent: requireRatio(body.percent, '阅读百分比')
    })
  })

  ipcMain.handle(IPC.booksDelete, (_event, bookId: unknown) => {
    store.deleteBook(requireString(bookId, '书籍 ID'))
  })

  ipcMain.handle(IPC.booksReorder, (_event, ids: unknown) => {
    store.reorderBooks(requireStringArray(ids, '书籍 ID 列表'))
  })

  ipcMain.handle(IPC.booksUpdateMeta, (_event, id: unknown, meta: unknown) => {
    const bookId = requireString(id, '书籍 ID')
    const body = assertObject(meta, '书籍信息')
    return store.updateBookMeta(bookId, {
      title: body.title === undefined ? undefined : requireString(body.title, '书名', { maxLength: 60 }),
      author: body.author === undefined ? undefined : requireString(body.author, '作者', { allowEmpty: true, maxLength: 30 })
    })
  })

  ipcMain.handle(IPC.booksSetCover, async (_event, id: unknown) => {
    const bookId = requireString(id, '书籍 ID')
    const source = await pickFile(['jpg', 'jpeg', 'png', 'webp'], '图片')
    if (!source) return
    const target = join(userDataDir, COVERS_DIR, `cover_${bookId}_${Date.now()}${extname(source)}`)
    mkdirSync(join(userDataDir, COVERS_DIR), { recursive: true })
    copyFileSync(source, target)
    store.setBookCover(bookId, target)
  })

  ipcMain.handle(IPC.booksSetGroup, (_event, ids: unknown, groupId: unknown) => {
    const bookIds = requireStringArray(ids, '书籍 ID 列表')
    const target =
      groupId === null || groupId === undefined || groupId === ''
        ? null
        : requireString(groupId, '分组 ID')
    store.setBooksGroup(bookIds, target)
  })

  // ---------- 分组 ----------
  ipcMain.handle(IPC.groupsList, () => store.listGroups())
  ipcMain.handle(IPC.groupsCreate, (_event, name: unknown) => {
    return store.createGroup(requireString(name, '分组名称', { maxLength: 20 }))
  })
  ipcMain.handle(IPC.groupsRename, (_event, id: unknown, name: unknown) => {
    store.renameGroup(
      requireString(id, '分组 ID'),
      requireString(name, '分组名称', { maxLength: 20 })
    )
  })
  ipcMain.handle(IPC.groupsDelete, (_event, id: unknown) => {
    store.deleteGroup(requireString(id, '分组 ID'))
  })

  // ---------- 书签 ----------
  ipcMain.handle(IPC.bookmarksList, (_event, bookId: unknown) => {
    return store.listBookmarks(requireString(bookId, '书籍 ID'))
  })

  ipcMain.handle(IPC.bookmarksToggle, (_event, input: unknown) => {
    const body = assertObject(input, '书签') as unknown as {
      bookId: string
      chapterIdx: number
      pageIdx: number
      pageIdxRatio: number
      snippet: string
    }
    return store.toggleBookmark({
      bookId: requireString(body.bookId, '书籍 ID'),
      chapterIdx: requireNonNegativeInt(body.chapterIdx, '章节序号'),
      pageIdx: requireNonNegativeInt(body.pageIdx, '页码'),
      pageIdxRatio: requireRatio(body.pageIdxRatio, '页内比例'),
      snippet: typeof body.snippet === 'string' ? body.snippet : ''
    })
  })

  ipcMain.handle(IPC.bookmarksDelete, (_event, id: unknown) => {
    store.deleteBookmark(requireString(id, '书签 ID'))
  })

  // ---------- 阅读统计 ----------
  ipcMain.handle(IPC.statsSummary, () => store.statsSummary())

  ipcMain.handle(IPC.statsFlush, (_event, input: unknown) => {
    const body = assertObject(input, '统计数据')
    store.addStatsToday(
      requireNonNegativeInt(body.durationMs, '时长'),
      requireNonNegativeInt(body.charCount, '字数')
    )
  })

  // ---------- 密码箱 ----------
  ipcMain.handle(IPC.passwordList, () => store.listPasswords())

  ipcMain.handle(IPC.passwordSave, (_event, input: unknown) => {
    const body = assertObject(input, '密码条目') as unknown as PasswordInput & { id?: string }
    store.savePassword({
      id: body.id,
      title: requireString(body.title, '名称'),
      url: typeof body.url === 'string' ? body.url.trim() : '',
      account: typeof body.account === 'string' ? body.account.trim() : '',
      password: typeof body.password === 'string' ? body.password : '',
      remark: typeof body.remark === 'string' ? body.remark : '',
      isFavorite: body.isFavorite === true
    })
  })

  ipcMain.handle(IPC.passwordDelete, (_event, id: unknown) => {
    store.deletePassword(requireString(id, '条目 ID'))
  })

  ipcMain.handle(IPC.passwordSetFavorite, (_event, id: unknown, isFavorite: unknown) => {
    store.setPasswordFavorite(requireString(id, '条目 ID'), isFavorite === true)
  })

  ipcMain.handle(IPC.passwordImportFixed, async () => {
    const filePath = await pickFile(['txt', 'md'])
    if (!filePath) return null
    const text = readFileSync(filePath, 'utf8')
    const { entries, skipped } = parsePasswordText(text)
    const duplicates = store.duplicateKeys()
    const drafts: PasswordDraft[] = entries.map((entry) => {
      const draft: PasswordDraft = { ...entry }
      const key = `${entry.title} ${entry.account}`
      if (entry.account && duplicates.has(key)) draft.duplicate = true
      return draft
    })
    return { imported: 0, skipped, entries: drafts }
  })

  ipcMain.handle(IPC.passwordImportAi, async () => {
    const filePath = await pickFile(['txt', 'md'])
    if (!filePath) return null
    const text = readFileSync(filePath, 'utf8')
    const { entries } = await passwordAi.recognize(text)
    const duplicates = store.duplicateKeys()
    for (const draft of entries) {
      const key = `${draft.title} ${draft.account}`
      if (draft.account && duplicates.has(key)) draft.duplicate = true
    }
    return entries
  })

  ipcMain.handle(IPC.passwordImportSave, (_event, drafts: unknown) => {
    if (!Array.isArray(drafts)) throw new Error('导入内容必须是数组')
    return store.savePasswordDrafts(drafts as PasswordDraft[])
  })

  // ---------- 记事本 ----------
  ipcMain.handle(IPC.notesList, () => store.listNotes())

  ipcMain.handle(IPC.notesSave, (_event, input: unknown) => {
    const body = assertObject(input, '笔记内容') as unknown as NoteSaveInput
    return store.saveNote({
      id: typeof body.id === 'string' && body.id ? body.id : undefined,
      title: requireString(body.title, '笔记标题', { allowEmpty: true, maxLength: 60 }),
      content: requireString(body.content, '笔记内容', { allowEmpty: true })
    })
  })

  ipcMain.handle(IPC.notesDelete, (_event, id: unknown) => {
    store.deleteNote(requireString(id, '笔记 ID'))
  })

  ipcMain.handle(IPC.notesImport, async () => {
    const filePath = await pickFile(['md', 'markdown', 'txt'], 'Markdown 文件')
    if (!filePath) return null
    const content = readFileSync(filePath, 'utf8')
    return store.saveNote({ title: basename(filePath, extname(filePath)), content })
  })

  ipcMain.handle(IPC.notesExport, async (_event, id: unknown) => {
    const noteId = requireString(id, '笔记 ID')
    const note = store.listNotes().find((item) => item.id === noteId)
    if (!note) throw new Error('笔记不存在')
    const targetPath = await saveMarkdownFile(`${note.title || '笔记'}.md`, note.content)
    return targetPath
  })

  // ---------- 背景 ----------
  ipcMain.handle(IPC.backgroundPick, async () => {
    const source = await pickFile(['jpg', 'jpeg', 'png', 'webp'], '图片')
    if (!source) return null
    const dir = join(userDataDir, BACKGROUNDS_DIR)
    mkdirSync(dir, { recursive: true })
    const target = join(dir, `bg_${Date.now()}${extname(source)}`)
    copyFileSync(source, target)
    return target
  })

  ipcMain.handle(IPC.backgroundClear, () => undefined)

  // ---------- 系统 ----------
  ipcMain.handle(IPC.systemCopy, (_event, text: unknown) => {
    clipboard.writeText(requireString(text, '复制内容', { allowEmpty: true }))
  })

  void assetsDir
}

function createChatEventSink(sender: Electron.WebContents): ChatEventSink {
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

async function pickFile(
  extensions: string[],
  title = '选择文件'
): Promise<string | null> {
  const window = BrowserWindow.getAllWindows()[0]
  const result = await dialog.showOpenDialog({
    title,
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
  writeFileSync(result.filePath, content, 'utf8')
  return result.filePath
}