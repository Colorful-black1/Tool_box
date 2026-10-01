import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

import Database from 'better-sqlite3'

import { DEFAULT_CONVERSATION_TITLE } from '../../../shared/constants'
import type {
  BookGroup,
  BookSummary,
  Bookmark,
  ChapterContent,
  ChapterMeta,
  ChatMessage,
  ChatRole,
  ConversationSummary,
  NoteSaveInput,
  NoteView,
  PasswordDraft,
  PasswordEntryView,
  PasswordInput,
  ReadingProgressInput,
  ReadingStat,
  StatsSummary
} from '../../../shared/types'
import type { SecretBox } from '../crypto/secret-box'
import { pinyinFirstLetter } from '../library/pinyin-util'

const MAX_TITLE_CHARS = 60
const SCHEMA_VERSION = 3

interface ConversationRow {
  id: string
  title: string
  created_at_ms: number
  updated_at_ms: number
  message_count?: number
}

interface MessageRow {
  id: string
  conversation_id: string
  role: string
  content: string
  created_at_ms: number
}

interface BookRow {
  id: string
  title: string
  author: string
  created_at_ms: number
  updated_at_ms: number
  chapter_count?: number
  progress_chapter: number | null
  progress_percent: number | null
  progress_updated: number | null
}

interface PasswordRow {
  id: string
  title: string
  url: string
  secret: string
  first_letter: string
  is_favorite: number
  created_at_ms: number
  updated_at_ms: number
}

interface SecretPayload {
  account: string
  password: string
  remark: string
}

const DECRYPT_FAIL_NOTE = '【解密失败：密钥不可用或数据损坏】'

/**
 * 统一本地数据层（SQLite / better-sqlite3），字段与旧 Flutter 项目对齐：
 * - v1 AI 会话与消息
 * - v2 小说（书/章节/进度）、密码箱、记事本
 * - v3 kv 配置表、书籍作者/封面/排序/分组、书签、阅读统计
 */
export class ToolboxStore {
  private readonly db: Database.Database

  constructor(
    dbPath: string,
    private readonly secretBox: SecretBox
  ) {
    mkdirSync(dirname(dbPath), { recursive: true })
    this.db = new Database(dbPath)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('foreign_keys = ON')
    this.migrate()
  }

  // ==================== kv 配置 ====================

  configGet(): Record<string, unknown> | null {
    const row = this.db.prepare(`SELECT value FROM kv WHERE key = 'read_config'`).get() as
      | { value: string }
      | undefined
    if (!row) return null
    try {
      return JSON.parse(row.value) as Record<string, unknown>
    } catch {
      return null
    }
  }

  configSet(patch: Record<string, unknown>): Record<string, unknown> | null {
    const current = this.configGet() ?? {}
    const next = { ...current, ...patch }
    this.db
      .prepare(
        `INSERT INTO kv (key, value) VALUES ('read_config', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`
      )
      .run(JSON.stringify(next))
    return next
  }

  // ==================== AI 会话 ====================

  listConversations(): ConversationSummary[] {
    const rows = this.db
      .prepare(
        `SELECT c.id, c.title, c.created_at_ms, c.updated_at_ms,
                COUNT(m.id) AS message_count
         FROM conversations c
         LEFT JOIN messages m ON m.conversation_id = c.id
         GROUP BY c.id
         ORDER BY c.updated_at_ms DESC`
      )
      .all() as ConversationRow[]
    return rows.map(toConversation)
  }

  getConversation(id: string): ConversationSummary | null {
    const row = this.db
      .prepare(
        `SELECT c.id, c.title, c.created_at_ms, c.updated_at_ms,
                COUNT(m.id) AS message_count
         FROM conversations c
         LEFT JOIN messages m ON m.conversation_id = c.id
         WHERE c.id = ?
         GROUP BY c.id`
      )
      .get(id) as ConversationRow | undefined
    return row ? toConversation(row) : null
  }

  createConversation(title = DEFAULT_CONVERSATION_TITLE): ConversationSummary {
    const now = Date.now()
    const id = randomUUID()
    this.db
      .prepare(
        `INSERT INTO conversations (id, title, created_at_ms, updated_at_ms)
         VALUES (?, ?, ?, ?)`
      )
      .run(id, normalizeTitle(title, DEFAULT_CONVERSATION_TITLE), now, now)
    const conversation = this.getConversation(id)
    if (!conversation) throw new Error('会话创建失败')
    return conversation
  }

  renameConversation(id: string, title: string): ConversationSummary {
    const now = Date.now()
    const result = this.db
      .prepare(`UPDATE conversations SET title = ?, updated_at_ms = ? WHERE id = ?`)
      .run(normalizeTitle(title), now, id)
    if (result.changes === 0) throw new Error('会话不存在')
    const conversation = this.getConversation(id)
    if (!conversation) throw new Error('会话不存在')
    return conversation
  }

  deleteConversation(id: string): void {
    const result = this.db.prepare('DELETE FROM conversations WHERE id = ?').run(id)
    if (result.changes === 0) throw new Error('会话不存在')
  }

  listMessages(conversationId: string): ChatMessage[] {
    this.requireConversation(conversationId)
    const rows = this.db
      .prepare(
        `SELECT id, conversation_id, role, content, created_at_ms
         FROM messages
         WHERE conversation_id = ?
         ORDER BY created_at_ms ASC, rowid ASC`
      )
      .all(conversationId) as MessageRow[]
    return rows.map((row) => ({
      id: row.id,
      conversationId: row.conversation_id,
      role: row.role as ChatRole,
      content: row.content,
      createdAtMs: row.created_at_ms
    }))
  }

  appendMessage(input: {
    conversationId: string
    role: ChatRole
    content: string
  }): ChatMessage {
    this.requireConversation(input.conversationId)
    const now = Date.now()
    const id = randomUUID()

    this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO messages (id, conversation_id, role, content, created_at_ms)
           VALUES (?, ?, ?, ?, ?)`
        )
        .run(id, input.conversationId, input.role, input.content, now)
      this.db
        .prepare(`UPDATE conversations SET updated_at_ms = ? WHERE id = ?`)
        .run(now, input.conversationId)
    })()

    return {
      id,
      conversationId: input.conversationId,
      role: input.role,
      content: input.content,
      createdAtMs: now
    }
  }

  // ==================== 小说 ====================

  listBooks(query = ''): BookSummary[] {
    const keyword = query.trim()
    const rows = this.db
      .prepare(
        `SELECT b.id, b.title, b.author, b.created_at_ms, b.updated_at_ms,
                b.cover_path, b.sort_index, b.group_id,
                (SELECT COUNT(*) FROM chapters ch WHERE ch.book_id = b.id) AS chapter_count,
                p.chapter_idx AS progress_chapter,
                p.percent AS progress_percent,
                p.updated_at_ms AS progress_updated
         FROM books b
         LEFT JOIN reading_progress p ON p.book_id = b.id
         WHERE (? = '' OR LOWER(b.title) LIKE ? OR LOWER(b.author) LIKE ?)
         ORDER BY
           CASE WHEN p.updated_at_ms IS NULL THEN 1 ELSE 0 END ASC,
           p.updated_at_ms DESC,
           b.sort_index ASC,
           b.created_at_ms DESC`
      )
      .all(keyword, `%${keyword.toLowerCase()}%`, `%${keyword.toLowerCase()}%`) as Array<
      BookRow & { cover_path: string; sort_index: number; group_id: string | null }
    >
    return rows.map(toBookSummary)
  }

  importBook(input: {
    title: string
    author: string
    chapters: Array<{ title: string; body: string }>
  }): BookSummary {
    if (input.chapters.length === 0) throw new Error('书籍内容为空')
    const now = Date.now()
    const bookId = randomUUID()
    const minSort = this.db
      .prepare(`SELECT COALESCE(MIN(sort_index), 0) AS m FROM books`)
      .get() as { m: number }

    const insertBook = this.db.prepare(
      `INSERT INTO books (id, title, author, cover_path, sort_index, group_id, created_at_ms, updated_at_ms)
       VALUES (?, ?, ?, '', ?, NULL, ?, ?)`
    )
    const insertChapter = this.db.prepare(
      `INSERT INTO chapters (id, book_id, idx, title, body, word_count)
       VALUES (?, ?, ?, ?, ?, ?)`
    )

    this.db.transaction(() => {
      insertBook.run(bookId, normalizeTitle(input.title), input.author.trim(), minSort.m, now, now)
      input.chapters.forEach((chapter, idx) => {
        insertChapter.run(
          randomUUID(),
          bookId,
          idx,
          normalizeTitle(chapter.title, '正文'),
          chapter.body,
          chapter.body.length
        )
      })
    })()

    const row = this.db
      .prepare(
        `SELECT b.id, b.title, b.author, b.created_at_ms, b.updated_at_ms,
                b.cover_path, b.sort_index, b.group_id,
                (SELECT COUNT(*) FROM chapters ch WHERE ch.book_id = b.id) AS chapter_count,
                NULL AS progress_chapter, NULL AS progress_percent, NULL AS progress_updated
         FROM books b WHERE b.id = ?`
      )
      .get(bookId) as BookRow & { cover_path: string; sort_index: number; group_id: string | null }
    if (!row) throw new Error('书籍导入失败')
    return toBookSummary(row)
  }

  updateBookMeta(
    id: string,
    meta: { title?: string; author?: string }
  ): BookSummary {
    const fields: string[] = []
    const values: unknown[] = []
    if (meta.title !== undefined) {
      fields.push('title = ?')
      values.push(normalizeTitle(meta.title))
    }
    if (meta.author !== undefined) {
      fields.push('author = ?')
      values.push(meta.author.trim())
    }
    if (fields.length === 0) throw new Error('没有需要更新的字段')
    fields.push('updated_at_ms = ?')
    values.push(Date.now(), id)
    const result = this.db
      .prepare(`UPDATE books SET ${fields.join(', ')} WHERE id = ?`)
      .run(...(values as string[]))
    if (result.changes === 0) throw new Error('书籍不存在')
    return this.getBook(id)
  }

  setBookCover(id: string, coverPath: string): void {
    const result = this.db.prepare(`UPDATE books SET cover_path = ? WHERE id = ?`).run(coverPath, id)
    if (result.changes === 0) throw new Error('书籍不存在')
  }

  setBooksGroup(ids: string[], groupId: string | null): void {
    const stmt = this.db.prepare(`UPDATE books SET group_id = ? WHERE id = ?`)
    this.db.transaction(() => {
      for (const id of ids) stmt.run(groupId, id)
    })()
  }

  reorderBooks(orderedIds: string[]): void {
    const stmt = this.db.prepare(`UPDATE books SET sort_index = ? WHERE id = ?`)
    this.db.transaction(() => {
      orderedIds.forEach((id, index) => stmt.run(index, id))
    })()
  }

  getBook(id: string): BookSummary {
    const row = this.db
      .prepare(
        `SELECT b.id, b.title, b.author, b.created_at_ms, b.updated_at_ms,
                b.cover_path, b.sort_index, b.group_id,
                (SELECT COUNT(*) FROM chapters ch WHERE ch.book_id = b.id) AS chapter_count,
                p.chapter_idx AS progress_chapter,
                p.percent AS progress_percent,
                p.updated_at_ms AS progress_updated
         FROM books b
         LEFT JOIN reading_progress p ON p.book_id = b.id
         WHERE b.id = ?`
      )
      .get(id) as
      | (BookRow & { cover_path: string; sort_index: number; group_id: string | null })
      | undefined
    if (!row) throw new Error('书籍不存在')
    return toBookSummary(row)
  }

  listChapters(bookId: string): ChapterMeta[] {
    this.requireBook(bookId)
    const rows = this.db
      .prepare(
        `SELECT id, idx, title, word_count
         FROM chapters WHERE book_id = ? ORDER BY idx ASC`
      )
      .all(bookId) as Array<{ id: string; idx: number; title: string; word_count: number }>
    return rows.map((row) => ({
      id: row.id,
      idx: row.idx,
      title: row.title,
      wordCount: row.word_count
    }))
  }

  chapterContent(chapterId: string): ChapterContent {
    const row = this.db
      .prepare(`SELECT id, idx, title, body FROM chapters WHERE id = ?`)
      .get(chapterId) as { id: string; idx: number; title: string; body: string } | undefined
    if (!row) throw new Error('章节不存在')
    return { id: row.id, idx: row.idx, title: row.title, content: row.body }
  }

  progressGet(bookId: string): { chapterIdx: number; percent: number } | null {
    this.requireBook(bookId)
    const row = this.db
      .prepare(`SELECT chapter_idx, percent FROM reading_progress WHERE book_id = ?`)
      .get(bookId) as { chapter_idx: number; percent: number } | undefined
    return row ? { chapterIdx: row.chapter_idx, percent: row.percent } : null
  }

  progressSave(input: ReadingProgressInput): void {
    this.requireBook(input.bookId)
    const now = Date.now()
    const percent = Math.min(1, Math.max(0, input.percent))
    const existing = this.db
      .prepare(`SELECT id FROM reading_progress WHERE book_id = ?`)
      .get(input.bookId) as { id: string } | undefined

    if (existing) {
      this.db
        .prepare(
          `UPDATE reading_progress
           SET chapter_idx = ?, percent = ?, updated_at_ms = ?
           WHERE id = ?`
        )
        .run(input.chapterIdx, percent, now, existing.id)
      return
    }

    this.db
      .prepare(
        `INSERT INTO reading_progress (id, book_id, chapter_idx, percent, updated_at_ms)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(randomUUID(), input.bookId, input.chapterIdx, percent, now)
  }

  deleteBook(bookId: string): void {
    this.requireBook(bookId)
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM reading_progress WHERE book_id = ?').run(bookId)
      this.db.prepare('DELETE FROM bookmarks WHERE book_id = ?').run(bookId)
      this.db.prepare('DELETE FROM chapters WHERE book_id = ?').run(bookId)
      this.db.prepare('DELETE FROM books WHERE id = ?').run(bookId)
    })()
  }

  // ==================== 分组 ====================

  listGroups(): BookGroup[] {
    const rows = this.db
      .prepare(`SELECT id, name, sort_index FROM book_groups ORDER BY sort_index ASC`)
      .all() as Array<{ id: string; name: string; sort_index: number }>
    return rows.map((row) => ({ id: row.id, name: row.name, sortIndex: row.sort_index }))
  }

  createGroup(name: string): BookGroup {
    const safeName = name.trim().slice(0, 20)
    if (!safeName) throw new Error('分组名称不能为空')
    const id = randomUUID()
    const minSort = this.db
      .prepare(`SELECT COALESCE(MIN(sort_index), 0) AS m FROM book_groups`)
      .get() as { m: number }
    this.db
      .prepare(`INSERT INTO book_groups (id, name, sort_index) VALUES (?, ?, ?)`)
      .run(id, safeName, minSort.m - 1)
    return { id, name: safeName, sortIndex: minSort.m - 1 }
  }

  renameGroup(id: string, name: string): void {
    const safeName = name.trim().slice(0, 20)
    if (!safeName) throw new Error('分组名称不能为空')
    const result = this.db.prepare(`UPDATE book_groups SET name = ? WHERE id = ?`).run(safeName, id)
    if (result.changes === 0) throw new Error('分组不存在')
  }

  deleteGroup(id: string): void {
    this.db.transaction(() => {
      this.db.prepare(`UPDATE books SET group_id = NULL WHERE group_id = ?`).run(id)
      const result = this.db.prepare(`DELETE FROM book_groups WHERE id = ?`).run(id)
      if (result.changes === 0) throw new Error('分组不存在')
    })()
  }

  // ==================== 书签 ====================

  listBookmarks(bookId: string): Bookmark[] {
    const rows = this.db
      .prepare(
        `SELECT id, book_id, chapter_idx, page_idx, page_idx_ratio, snippet, created_at_ms
         FROM bookmarks WHERE book_id = ?
         ORDER BY chapter_idx ASC, page_idx ASC`
      )
      .all(bookId) as Array<{
      id: string
      book_id: string
      chapter_idx: number
      page_idx: number
      page_idx_ratio: number
      snippet: string
      created_at_ms: number
    }>
    return rows.map((row) => ({
      id: row.id,
      bookId: row.book_id,
      chapterIdx: row.chapter_idx,
      pageIdx: row.page_idx,
      pageIdxRatio: row.page_idx_ratio,
      snippet: row.snippet,
      createdAtMs: row.created_at_ms
    }))
  }

  /** 幂等键 (book_id, chapter_idx, page_idx)：已存在则全部删除，返回 { active: false } */
  toggleBookmark(input: {
    bookId: string
    chapterIdx: number
    pageIdx: number
    pageIdxRatio: number
    snippet: string
  }): { active: boolean } {
    const existing = this.db
      .prepare(
        `SELECT id FROM bookmarks
         WHERE book_id = ? AND chapter_idx = ? AND page_idx = ?`
      )
      .all(input.bookId, input.chapterIdx, input.pageIdx) as Array<{ id: string }>

    if (existing.length > 0) {
      const stmt = this.db.prepare(`DELETE FROM bookmarks WHERE id = ?`)
      this.db.transaction(() => {
        for (const row of existing) stmt.run(row.id)
      })()
      return { active: false }
    }

    this.db
      .prepare(
        `INSERT INTO bookmarks
           (id, book_id, chapter_idx, page_idx, page_idx_ratio, snippet, created_at_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        randomUUID(),
        input.bookId,
        input.chapterIdx,
        input.pageIdx,
        Math.min(1, Math.max(0, input.pageIdxRatio)),
        input.snippet.slice(0, 60),
        Date.now()
      )
    return { active: true }
  }

  deleteBookmark(id: string): void {
    this.db.prepare('DELETE FROM bookmarks WHERE id = ?').run(id)
  }

  // ==================== 阅读统计 ====================

  addStatsToday(durationMs: number, charCount: number): void {
    if (durationMs <= 0 && charCount <= 0) return
    this.db
      .prepare(
        `INSERT INTO reading_stats (date, duration_ms, char_count)
         VALUES (?, ?, ?)
         ON CONFLICT(date) DO UPDATE SET
           duration_ms = duration_ms + excluded.duration_ms,
           char_count = char_count + excluded.char_count`
      )
      .run(todayKey(), Math.max(0, durationMs), Math.max(0, charCount))
  }

  statsSummary(): StatsSummary {
    const rows = this.db
      .prepare(
        `SELECT date, duration_ms, char_count
         FROM reading_stats ORDER BY date DESC`
      )
      .all() as Array<{ date: string; duration_ms: number; char_count: number }>

    const today = todayKey()
    const recent: ReadingStat[] = rows.slice(0, 7).map((row) => ({
      date: row.date,
      durationMs: row.duration_ms,
      charCount: row.char_count
    }))
    const todayRow = rows.find((row) => row.date === today)

    return {
      todayDurationMs: todayRow?.duration_ms ?? 0,
      totalDurationMs: rows.reduce((sum, row) => sum + row.duration_ms, 0),
      totalCharCount: rows.reduce((sum, row) => sum + row.char_count, 0),
      recent
    }
  }

  // ==================== 密码箱 ====================

  listPasswords(): PasswordEntryView[] {
    const rows = this.db
      .prepare(
        `SELECT id, title, url, secret, first_letter, is_favorite, created_at_ms, updated_at_ms
         FROM password_entries
         ORDER BY is_favorite DESC, first_letter ASC, updated_at_ms DESC, id DESC`
      )
      .all() as PasswordRow[]
    return rows.map((row) => this.toPasswordView(row))
  }

  savePassword(input: PasswordInput & { id?: string }): void {
    const title = normalizeTitle(input.title, '')
    if (!title || title === '未命名') throw new Error('名称不能为空')
    const secret = this.secretBox.encrypt({
      account: input.account.trim(),
      password: input.password,
      remark: input.remark
    })
    const firstLetter = firstLetterOf(title)
    const updatedAt = input.updatedAtMs ?? Date.now()

    if (input.id) {
      const result = this.db
        .prepare(
          `UPDATE password_entries
           SET title = ?, url = ?, secret = ?, first_letter = ?, updated_at_ms = ?
           WHERE id = ?`
        )
        .run(title, input.url.trim(), secret, firstLetter, updatedAt, input.id)
      if (result.changes === 0) throw new Error('条目不存在')
      return
    }

    this.db
      .prepare(
        `INSERT INTO password_entries
           (id, title, url, secret, first_letter, is_favorite, created_at_ms, updated_at_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        randomUUID(),
        title,
        input.url.trim(),
        secret,
        firstLetter,
        input.isFavorite ? 1 : 0,
        updatedAt,
        updatedAt
      )
  }

  /** 批量导入：直接落库，跳过与既有条目「同名 + 同账号」的重复项 */
  savePasswordDrafts(drafts: PasswordDraft[]): number {
    const existing = new Set(
      this.listPasswords().map((entry) => `${entry.title} ${entry.account}`)
    )
    let imported = 0
    for (const draft of drafts) {
      const title = normalizeTitle(draft.title, '')
      if (!title || title === '未命名') continue
      const account = draft.account.trim()
      const key = `${title} ${account}`
      if (account && existing.has(key)) continue
      const ts = draft.updatedAtMs ?? Date.now()
      this.savePassword({
        title,
        url: draft.url,
        account,
        password: draft.password,
        remark: draft.remark,
        updatedAtMs: ts
      })
      existing.add(key)
      imported += 1
    }
    return imported
  }

  /** 已存在同名同账号的条目集合，用于导入预览标记「已存在」 */
  duplicateKeys(): Set<string> {
    const rows = this.db
      .prepare(`SELECT title, secret FROM password_entries`)
      .all() as Array<{ title: string; secret: string }>
    const keys = new Set<string>()
    for (const row of rows) {
      try {
        const secret = this.secretBox.decrypt(row.secret)
        if (secret.account) keys.add(`${row.title} ${secret.account}`)
      } catch {
        /* 解密失败不影响重复判定 */
      }
    }
    return keys
  }

  deletePassword(id: string): void {
    const result = this.db.prepare('DELETE FROM password_entries WHERE id = ?').run(id)
    if (result.changes === 0) throw new Error('条目不存在')
  }

  setPasswordFavorite(id: string, isFavorite: boolean): void {
    const result = this.db
      .prepare(`UPDATE password_entries SET is_favorite = ?, updated_at_ms = ? WHERE id = ?`)
      .run(isFavorite ? 1 : 0, Date.now(), id)
    if (result.changes === 0) throw new Error('条目不存在')
  }

  private toPasswordView(row: PasswordRow): PasswordEntryView {
    let secret: SecretPayload
    let decrypted = true
    try {
      secret = this.secretBox.decrypt(row.secret)
    } catch {
      secret = { account: '', password: '', remark: DECRYPT_FAIL_NOTE }
      decrypted = false
    }
    return {
      id: row.id,
      title: row.title,
      url: row.url,
      account: secret.account,
      password: secret.password,
      remark: secret.remark,
      firstLetter: row.first_letter,
      isFavorite: row.is_favorite === 1,
      createdAtMs: row.created_at_ms,
      updatedAtMs: row.updated_at_ms,
      isDecryptable: decrypted
    }
  }

  // ==================== 记事本 ====================

  listNotes(): NoteView[] {
    const rows = this.db
      .prepare(
        `SELECT id, title, content, created_at_ms, updated_at_ms
         FROM notes ORDER BY updated_at_ms DESC, id DESC`
      )
      .all() as Array<{
      id: string
      title: string
      content: string
      created_at_ms: number
      updated_at_ms: number
    }>
    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      content: row.content,
      createdAtMs: row.created_at_ms,
      updatedAtMs: row.updated_at_ms
    }))
  }

  saveNote(input: NoteSaveInput): NoteView {
    const now = Date.now()
    const title = input.title.trim()

    if (input.id) {
      const existing = this.db
        .prepare(`SELECT created_at_ms FROM notes WHERE id = ?`)
        .get(input.id) as { created_at_ms: number } | undefined
      if (!existing) throw new Error('笔记不存在')
      this.db
        .prepare(`UPDATE notes SET title = ?, content = ?, updated_at_ms = ? WHERE id = ?`)
        .run(title, input.content, now, input.id)
      return {
        id: input.id,
        title,
        content: input.content,
        createdAtMs: existing.created_at_ms,
        updatedAtMs: now
      }
    }

    const id = randomUUID()
    this.db
      .prepare(
        `INSERT INTO notes (id, title, content, created_at_ms, updated_at_ms)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(id, title, input.content, now, now)
    return { id, title, content: input.content, createdAtMs: now, updatedAtMs: now }
  }

  deleteNote(id: string): void {
    const result = this.db.prepare('DELETE FROM notes WHERE id = ?').run(id)
    if (result.changes === 0) throw new Error('笔记不存在')
  }

  // ==================== 生命周期 ====================

  close(): void {
    this.db.close()
  }

  // ==================== 迁移 ====================

  private migrate(): void {
    const current = this.db.pragma('user_version', { simple: true }) as number
    if (current >= SCHEMA_VERSION) return

    if (current < 1) {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS conversations (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          created_at_ms INTEGER NOT NULL,
          updated_at_ms INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS messages (
          id TEXT PRIMARY KEY,
          conversation_id TEXT NOT NULL,
          role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
          content TEXT NOT NULL,
          created_at_ms INTEGER NOT NULL,
          FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_messages_conversation_time
          ON messages(conversation_id, created_at_ms);
      `)
    }

    if (current < 2) {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS books (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          author TEXT NOT NULL DEFAULT '',
          cover_path TEXT NOT NULL DEFAULT '',
          sort_index INTEGER NOT NULL DEFAULT 0,
          group_id TEXT,
          created_at_ms INTEGER NOT NULL,
          updated_at_ms INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS chapters (
          id TEXT PRIMARY KEY,
          book_id TEXT NOT NULL,
          idx INTEGER NOT NULL,
          title TEXT NOT NULL,
          body TEXT NOT NULL,
          word_count INTEGER NOT NULL,
          FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_chapters_book_idx ON chapters(book_id, idx);

        CREATE TABLE IF NOT EXISTS reading_progress (
          id TEXT PRIMARY KEY,
          book_id TEXT UNIQUE NOT NULL,
          chapter_idx INTEGER NOT NULL,
          percent REAL NOT NULL DEFAULT 0,
          updated_at_ms INTEGER NOT NULL,
          FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS password_entries (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          url TEXT NOT NULL DEFAULT '',
          secret TEXT NOT NULL,
          first_letter TEXT NOT NULL DEFAULT '#',
          is_favorite INTEGER NOT NULL DEFAULT 0,
          created_at_ms INTEGER NOT NULL,
          updated_at_ms INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS notes (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          content TEXT NOT NULL,
          created_at_ms INTEGER NOT NULL,
          updated_at_ms INTEGER NOT NULL
        );
      `)
    }

    if (current < 3) {
      // v2 → v3：补齐作者 / 排序 / 分组 / 统计比例 / 书签 / 统计 / kv
      const bookColumns = this.tableColumns('books')
      if (!bookColumns.includes('author')) {
        this.db.exec(`ALTER TABLE books ADD COLUMN author TEXT NOT NULL DEFAULT ''`)
      }
      if (!bookColumns.includes('cover_path')) {
        this.db.exec(`ALTER TABLE books ADD COLUMN cover_path TEXT NOT NULL DEFAULT ''`)
      }
      if (!bookColumns.includes('sort_index')) {
        this.db.exec(`ALTER TABLE books ADD COLUMN sort_index INTEGER NOT NULL DEFAULT 0`)
      }
      if (!bookColumns.includes('group_id')) {
        this.db.exec(`ALTER TABLE books ADD COLUMN group_id TEXT`)
      }

      const progressColumns = this.tableColumns('reading_progress')
      if (!progressColumns.includes('percent')) {
        this.db.exec(`ALTER TABLE reading_progress ADD COLUMN percent REAL NOT NULL DEFAULT 0`)
      }

      const passwordColumns = this.tableColumns('password_entries')
      if (!passwordColumns.includes('first_letter')) {
        this.db.exec(
          `ALTER TABLE password_entries ADD COLUMN first_letter TEXT NOT NULL DEFAULT '#'`
        )
      }

      this.db.exec(`
        CREATE TABLE IF NOT EXISTS kv (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS book_groups (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          sort_index INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS bookmarks (
          id TEXT PRIMARY KEY,
          book_id TEXT NOT NULL,
          chapter_idx INTEGER NOT NULL,
          page_idx INTEGER NOT NULL,
          page_idx_ratio REAL NOT NULL DEFAULT 0,
          snippet TEXT NOT NULL DEFAULT '',
          created_at_ms INTEGER NOT NULL,
          FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_bookmarks_book
          ON bookmarks(book_id, chapter_idx, page_idx);

        CREATE TABLE IF NOT EXISTS reading_stats (
          date TEXT PRIMARY KEY,
          duration_ms INTEGER NOT NULL DEFAULT 0,
          char_count INTEGER NOT NULL DEFAULT 0
        );
      `)

      // 书签的章内比例列（v3 早期版本缺失）
      const bookmarkColumns = this.tableColumns('bookmarks')
      if (!bookmarkColumns.includes('page_idx_ratio')) {
        this.db.exec(
          `ALTER TABLE bookmarks ADD COLUMN page_idx_ratio REAL NOT NULL DEFAULT 0`
        )
      }
    }

    this.db.pragma(`user_version = ${SCHEMA_VERSION}`)
  }

  private tableColumns(table: string): string[] {
    const rows = this.db.pragma(`table_info(${table})`) as Array<{ name: string }>
    return rows.map((row) => row.name)
  }

  private requireConversation(id: string): void {
    const exists = this.db.prepare('SELECT 1 FROM conversations WHERE id = ?').get(id)
    if (!exists) throw new Error('会话不存在')
  }

  private requireBook(id: string): void {
    const exists = this.db.prepare('SELECT 1 FROM books WHERE id = ?').get(id)
    if (!exists) throw new Error('书籍不存在')
  }
}

function normalizeTitle(input: string, fallback = '未命名'): string {
  const title = input.replace(/\s+/g, ' ').trim()
  if (!title) return fallback
  return title.length > MAX_TITLE_CHARS ? `${title.slice(0, MAX_TITLE_CHARS)}…` : title
}

function toConversation(row: ConversationRow): ConversationSummary {
  return {
    id: row.id,
    title: row.title,
    createdAtMs: row.created_at_ms,
    updatedAtMs: row.updated_at_ms,
    messageCount: row.message_count ?? 0
  }
}

function toBookSummary(
  row: BookRow & { cover_path: string; sort_index: number; group_id: string | null }
): BookSummary {
  return {
    id: row.id,
    title: row.title,
    author: row.author,
    chapterCount: row.chapter_count ?? 0,
    coverPath: row.cover_path,
    sortIndex: row.sort_index,
    groupId: row.group_id,
    createdAtMs: row.created_at_ms,
    updatedAtMs: row.updated_at_ms,
    progress:
      row.progress_chapter !== null
        ? {
            chapterIdx: row.progress_chapter,
            percent: row.progress_percent ?? 0,
            updatedAtMs: row.progress_updated ?? 0
          }
        : null
  }
}

/** 首字母：ASCII → 大写；CJK → 拼音首字母；其余 → '#' */
function firstLetterOf(title: string): string {
  const trimmed = title.trim()
  if (!trimmed) return '#'
  const first = trimmed[0]
  if (/[a-zA-Z]/.test(first)) return first.toUpperCase()
  if ((trimmed.codePointAt(0) ?? 0) >= 0x4e00) return pinyinFirstLetter(trimmed)
  return '#'
}

function todayKey(): string {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

export { DECRYPT_FAIL_NOTE, firstLetterOf, pinyinFirstLetter }