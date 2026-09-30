import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

import Database from 'better-sqlite3'

import { DEFAULT_CONVERSATION_TITLE } from '../../../shared/constants'
import type {
  BookSummary,
  ChapterContent,
  ChapterMeta,
  ChatMessage,
  ChatRole,
  ConversationSummary,
  NoteSaveInput,
  NoteView,
  PasswordEntryView,
  PasswordInput,
  ReadingProgressInput
} from '../../../shared/types'
import type { SecretBox } from '../crypto/secret-box'

const MAX_TITLE_CHARS = 60
const SCHEMA_VERSION = 2

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
  created_at_ms: number
  updated_at_ms: number
  chapter_count?: number
  progress_chapter: number | null
  progress_offset: number | null
  progress_updated: number | null
}

interface PasswordRow {
  id: string
  title: string
  url: string
  secret: string
  is_favorite: number
  created_at_ms: number
  updated_at_ms: number
}

interface SecretPayload {
  account: string
  password: string
  remark: string
}

/**
 * 统一本地数据层（SQLite / better-sqlite3）：
 * - AI 会话与消息（v1 表）
 * - 小说：书 / 章节 / 阅读进度（v2 表）
 * - 密码箱：敏感字段经 SecretBox 加密后落库（v2 表）
 * - 记事本（v2 表）
 * 迁移链由 user_version 控制，全部 SQL 走参数化。
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

  listBooks(): BookSummary[] {
    const rows = this.db
      .prepare(
        `SELECT b.id, b.title, b.created_at_ms, b.updated_at_ms,
                (SELECT COUNT(*) FROM chapters ch WHERE ch.book_id = b.id) AS chapter_count,
                p.chapter_idx AS progress_chapter,
                p.offset_ratio AS progress_offset,
                p.updated_at_ms AS progress_updated
         FROM books b
         LEFT JOIN reading_progress p ON p.book_id = b.id
         ORDER BY
           CASE WHEN p.updated_at_ms IS NULL THEN 1 ELSE 0 END ASC,
           p.updated_at_ms DESC,
           b.updated_at_ms DESC`
      )
      .all() as BookRow[]
    return rows.map(toBookSummary)
  }

  importBook(input: {
    title: string
    chapters: Array<{ title: string; body: string }>
  }): BookSummary {
    if (input.chapters.length === 0) throw new Error('书籍内容为空')
    const now = Date.now()
    const bookId = randomUUID()

    const insertBook = this.db.prepare(
      `INSERT INTO books (id, title, created_at_ms, updated_at_ms)
       VALUES (?, ?, ?, ?)`
    )
    const insertChapter = this.db.prepare(
      `INSERT INTO chapters (id, book_id, idx, title, body, word_count)
       VALUES (?, ?, ?, ?, ?, ?)`
    )

    this.db.transaction(() => {
      insertBook.run(bookId, normalizeTitle(input.title), now, now)
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

    const book = this.db
      .prepare(
        `SELECT b.id, b.title, b.created_at_ms, b.updated_at_ms,
                (SELECT COUNT(*) FROM chapters ch WHERE ch.book_id = b.id) AS chapter_count,
                NULL AS progress_chapter, NULL AS progress_offset, NULL AS progress_updated
         FROM books b WHERE b.id = ?`
      )
      .get(bookId) as BookRow | undefined
    if (!book) throw new Error('书籍导入失败')
    return toBookSummary(book)
  }

  listChapters(bookId: string): ChapterMeta[] {
    this.requireBook(bookId)
    const rows = this.db
      .prepare(
        `SELECT id, idx, title, word_count
         FROM chapters
         WHERE book_id = ?
         ORDER BY idx ASC`
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

  progressGet(bookId: string): { chapterIdx: number; offsetRatio: number } | null {
    this.requireBook(bookId)
    const row = this.db
      .prepare(`SELECT chapter_idx, offset_ratio FROM reading_progress WHERE book_id = ?`)
      .get(bookId) as { chapter_idx: number; offset_ratio: number } | undefined
    return row ? { chapterIdx: row.chapter_idx, offsetRatio: row.offset_ratio } : null
  }

  progressSave(input: ReadingProgressInput): void {
    this.requireBook(input.bookId)
    const now = Date.now()
    const ratio = Math.min(1, Math.max(0, input.offsetRatio))
    const existing = this.db
      .prepare(`SELECT id FROM reading_progress WHERE book_id = ?`)
      .get(input.bookId) as { id: string } | undefined

    if (existing) {
      this.db
        .prepare(
          `UPDATE reading_progress
           SET chapter_idx = ?, offset_ratio = ?, updated_at_ms = ?
           WHERE id = ?`
        )
        .run(input.chapterIdx, ratio, now, existing.id)
      return
    }

    this.db
      .prepare(
        `INSERT INTO reading_progress (id, book_id, chapter_idx, offset_ratio, updated_at_ms)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(randomUUID(), input.bookId, input.chapterIdx, ratio, now)
  }

  deleteBook(bookId: string): void {
    this.requireBook(bookId)
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM reading_progress WHERE book_id = ?').run(bookId)
      this.db.prepare('DELETE FROM chapters WHERE book_id = ?').run(bookId)
      this.db.prepare('DELETE FROM books WHERE id = ?').run(bookId)
    })()
  }

  // ==================== 密码箱 ====================

  listPasswords(): PasswordEntryView[] {
    const rows = this.db
      .prepare(
        `SELECT id, title, url, secret, is_favorite, created_at_ms, updated_at_ms
         FROM password_entries
         ORDER BY is_favorite DESC, updated_at_ms DESC`
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

    if (input.id) {
      const result = this.db
        .prepare(
          `UPDATE password_entries
           SET title = ?, url = ?, secret = ?, updated_at_ms = ?
           WHERE id = ?`
        )
        .run(title, input.url.trim(), secret, Date.now(), input.id)
      if (result.changes === 0) throw new Error('条目不存在')
      return
    }

    this.db
      .prepare(
        `INSERT INTO password_entries
           (id, title, url, secret, is_favorite, created_at_ms, updated_at_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        randomUUID(),
        title,
        input.url.trim(),
        secret,
        input.isFavorite ? 1 : 0,
        Date.now(),
        Date.now()
      )
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
    try {
      secret = this.secretBox.decrypt(row.secret)
    } catch {
      secret = { account: '', password: '', remark: '' }
    }
    return {
      id: row.id,
      title: row.title,
      url: row.url,
      account: secret.account,
      password: secret.password,
      remark: secret.remark,
      isFavorite: row.is_favorite === 1,
      createdAtMs: row.created_at_ms,
      updatedAtMs: row.updated_at_ms
    }
  }

  // ==================== 记事本 ====================

  listNotes(): NoteView[] {
    const rows = this.db
      .prepare(
        `SELECT id, title, content, created_at_ms, updated_at_ms
         FROM notes
         ORDER BY updated_at_ms DESC`
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

  private migrate(): void {
    const currentVersion = this.db.pragma('user_version', { simple: true }) as number
    if (currentVersion >= SCHEMA_VERSION) return

    if (currentVersion < 1) {
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

    if (currentVersion < 2) {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS books (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
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
          offset_ratio REAL NOT NULL,
          updated_at_ms INTEGER NOT NULL,
          FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS password_entries (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          url TEXT NOT NULL DEFAULT '',
          secret TEXT NOT NULL,
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

    this.db.pragma(`user_version = ${SCHEMA_VERSION}`)
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

function toBookSummary(row: BookRow): BookSummary {
  return {
    id: row.id,
    title: row.title,
    chapterCount: row.chapter_count ?? 0,
    createdAtMs: row.created_at_ms,
    updatedAtMs: row.updated_at_ms,
    progress:
      row.progress_chapter !== null
        ? {
            chapterIdx: row.progress_chapter,
            offsetRatio: row.progress_offset ?? 0,
            updatedAtMs: row.progress_updated ?? 0
          }
        : null
  }
}
