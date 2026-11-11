import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'

import Database from 'better-sqlite3'

import { COVERS_DIR, DEFAULT_CONVERSATION_TITLE } from '../../../shared/constants'
import { isKbDocumentStatus } from '../../../shared/knowledge-base'
import type {
  KbChunkPreview,
  KbDocumentStatus,
  KbDocumentView,
  KbListInput,
  KbSearchHit
} from '../../../shared/knowledge-base'
import type {
  BookGroup,
  BookSummary,
  Bookmark,
  ChapterContent,
  ChapterMeta,
  ChatCheckpointView,
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
  StatsRange,
  StatsSummary,
  TodoInput,
  TodoView,
  TodoQuery
} from '../../../shared/types'
import { buildStatsRange, todayKey } from '../../../shared/reading-stats'
import type { SecretBox } from '../crypto/secret-box'
import { pinyinFirstLetter } from '../library/pinyin-util'
import { dueTodoReminder } from '../../../shared/todo-reminders'
import type { TodoReminder, TodoReminderCandidate } from '../../../shared/todo-reminders'

const MAX_TITLE_CHARS = 60
const SCHEMA_VERSION = 7
/** 知识库文档摘要列：附带指定模型的已向量化块数，列表与详情共用。 */
const KB_DOCUMENT_COLUMNS = `id, title, category, source_path, file_size, status, chunk_count,
  (SELECT COUNT(*) FROM kb_chunks c
    WHERE c.document_id = kb_documents.id AND c.embedding IS NOT NULL
      AND (? = '' OR c.embedding_model = ?)) AS embedded_chunk_count,
  error, created_at_ms, updated_at_ms`

/** SQLite 的 snake_case 行只在数据层映射。 */
interface TodoRow {
  id: string
  title: string
  details: string
  priority: TodoInput['priority']
  start_at_ms: number | null
  due_at_ms: number | null
  remind: number
  completed_at_ms: number | null
  archived_at_ms: number | null
  created_at_ms: number
  updated_at_ms: number
}

function toTodo(row: TodoRow): TodoView {
  return {
    id: row.id,
    title: row.title,
    details: row.details,
    priority: row.priority,
    startAtMs: row.start_at_ms,
    dueAtMs: row.due_at_ms,
    remind: row.remind === 1,
    completedAtMs: row.completed_at_ms,
    archivedAtMs: row.archived_at_ms,
    createdAtMs: row.created_at_ms,
    updatedAtMs: row.updated_at_ms
  }
}

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

interface CheckpointRow {
  id: string
  conversation_id: string
  summary: string
  covered_message_id: string
  covered_message_count: number
  omitted_message_count: number
  summary_tokens: number
  source_tokens: number
  model: string
  created_at_ms: number
}

/** 写入检查点的入参；token 均为本地估算值 */
export interface ChatCheckpointInput {
  conversationId: string
  summary: string
  coveredMessageId: string
  coveredMessageCount: number
  omittedMessageCount: number
  summaryTokens: number
  sourceTokens: number
  model: string
}

function toMessage(row: MessageRow): ChatMessage {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    role: row.role as ChatRole,
    content: row.content,
    createdAtMs: row.created_at_ms
  }
}

function toCheckpoint(row: CheckpointRow): ChatCheckpointView {
  return {
    id: row.id,
    coveredMessageId: row.covered_message_id,
    coveredMessageCount: row.covered_message_count,
    omittedMessageCount: row.omitted_message_count,
    summary: row.summary,
    tokens: row.summary_tokens,
    sourceTokens: row.source_tokens,
    model: row.model,
    createdAtMs: row.created_at_ms
  }
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

interface KbDocumentRow {
  id: string
  title: string
  category: string
  source_path: string
  file_size: number
  status: string
  chunk_count: number
  embedded_chunk_count: number
  error: string
  created_at_ms: number
  updated_at_ms: number
}

interface KbChunkPreviewRow {
  id: string
  ordinal: number
  heading: string
  char_count: number
  start_offset: number
  preview: string
}

interface KbSearchRow {
  chunk_id: string
  document_id: string
  ordinal: number
  heading: string
  content: string
  start_offset: number
  char_count: number
  document_title: string
  category: string
  score: number
}

/** 导入前已由服务层校验文件大小、sha 与配额，这里只负责落库。 */
export interface KbDocumentInput {
  id: string
  title: string
  category: string
  sourcePath: string
  fileSize: number
  sha256: string
  createdAtMs: number
  updatedAtMs: number
}

export interface KbChunkInput {
  id: string
  ordinal: number
  heading: string
  content: string
  startOffset: number
  charCount: number
  /** 中文二元组 + 拉丁词，写入 FTS 的 tokens 列。 */
  tokens: string
}

/** 重建时源文件可能变化，标题、大小与 sha 同步更新。 */
export interface KbDocumentSourceInput {
  title: string
  fileSize: number
  sha256: string
  updatedAtMs: number
}

/** 待向量化的分块：只带拼向量用的标题与正文。 */
export interface KbEmbeddingChunkRow {
  id: string
  heading: string
  content: string
}

/** 向量落库：float32 小端 BLOB + 模型与维度。 */
export interface KbChunkEmbeddingInput {
  id: string
  embedding: Buffer
  model: string
  dim: number
}

/** 语义检索的向量索引行：元数据 + BLOB，正文按命中再取。 */
export interface KbVectorIndexRow {
  chunk_id: string
  document_id: string
  ordinal: number
  heading: string
  char_count: number
  start_offset: number
  document_title: string
  category: string
  embedding: Buffer
}

/**
 * 统一本地数据层（SQLite / better-sqlite3），字段与旧 Flutter 项目对齐：
 * - v1 AI 会话与消息
 * - v2 小说（书/章节/进度）、密码箱、记事本
 * - v3 kv 配置表、书籍作者/封面/排序/分组、书签、阅读统计
 * - v4 封面路径改为相对文件名（只存 covers/ 下的文件名）
 * - v5 待办清单
 * - v6 本地知识库（文档 / 分块 / FTS5 关键词索引）
 */
export class ToolboxStore {
  private readonly db: Database.Database
  /** 封面目录：与数据库文件同级，因此可由 dbPath 直接推导 */
  private readonly coversDir: string

  constructor(
    private readonly dbPath: string,
    private readonly secretBox: SecretBox
  ) {
    mkdirSync(dirname(dbPath), { recursive: true })
    this.coversDir = join(dirname(dbPath), COVERS_DIR)
    this.db = new Database(dbPath)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('foreign_keys = ON')
    try {
      this.migrate()
    } catch (error) {
      this.db.close()
      throw error
    }
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

  /** 命令库使用独立记录，不通过阅读／外观配置覆盖。 */
  commandLibraryGet(): string | null {
    const row = this.db.prepare('SELECT value FROM kv WHERE key = ?').get('developer_commands_v1') as
      { value: string } | undefined
    return row?.value ?? null
  }

  commandLibrarySet(value: string): void {
    this.db.prepare(
      'INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    ).run('developer_commands_v1', value)
  }

  /** 独立 kv 记录仅接受密文，不经普通 config 接口返回。 */
  agentDraftCipherGet(): string | null {
    const row = this.db.prepare('SELECT value FROM kv WHERE key = ?').get('agent_drafts_v1') as
      { value: string } | undefined
    return row?.value ?? null
  }

  agentDraftCipherSet(cipherText: string): void {
    this.db
      .prepare(
        'INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
      )
      .run('agent_drafts_v1', cipherText)
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
    return rows.map(toMessage)
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

  messageCount(conversationId: string): number {
    this.requireConversation(conversationId)
    const row = this.db
      .prepare('SELECT COUNT(*) AS count FROM messages WHERE conversation_id = ?')
      .get(conversationId) as { count: number }
    return row.count
  }

  /** 当前生效的检查点：最新一条；没有时返回 null */
  latestCheckpoint(conversationId: string): ChatCheckpointView | null {
    this.requireConversation(conversationId)
    const row = this.db
      .prepare(
        `SELECT id, conversation_id, summary, covered_message_id, covered_message_count,
                omitted_message_count, summary_tokens, source_tokens, model, created_at_ms
         FROM conversation_checkpoints
         WHERE conversation_id = ?
         ORDER BY created_at_ms DESC, rowid DESC
         LIMIT 1`
      )
      .get(conversationId) as CheckpointRow | undefined
    return row ? toCheckpoint(row) : null
  }

  /** 检查点之后仍需原文发送的消息；边界不存在时安全回退为全部消息 */
  listMessagesAfter(conversationId: string, messageId: string | null): ChatMessage[] {
    this.requireConversation(conversationId)
    if (!messageId) return this.listMessages(conversationId)

    const boundary = this.db
      .prepare('SELECT rowid AS row_id FROM messages WHERE id = ? AND conversation_id = ?')
      .get(messageId, conversationId) as { row_id: number } | undefined
    if (!boundary) return this.listMessages(conversationId)

    const rows = this.db
      .prepare(
        `SELECT id, conversation_id, role, content, created_at_ms
         FROM messages
         WHERE conversation_id = ? AND rowid > ?
         ORDER BY created_at_ms ASC, rowid ASC`
      )
      .all(conversationId, boundary.row_id) as MessageRow[]
    return rows.map(toMessage)
  }

  insertCheckpoint(input: ChatCheckpointInput): ChatCheckpointView {
    this.requireConversation(input.conversationId)
    const id = randomUUID()
    const now = Date.now()
    this.db
      .prepare(
        `INSERT INTO conversation_checkpoints
           (id, conversation_id, summary, covered_message_id, covered_message_count,
            omitted_message_count, summary_tokens, source_tokens, model, created_at_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.conversationId,
        input.summary,
        input.coveredMessageId,
        input.coveredMessageCount,
        input.omittedMessageCount,
        input.summaryTokens,
        input.sourceTokens,
        input.model,
        now
      )
    return {
      id,
      coveredMessageId: input.coveredMessageId,
      coveredMessageCount: input.coveredMessageCount,
      omittedMessageCount: input.omittedMessageCount,
      summary: input.summary,
      tokens: input.summaryTokens,
      sourceTokens: input.sourceTokens,
      model: input.model,
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
    return rows.map((row) => toBookSummary(row, this.coversDir))
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
    return toBookSummary(row, this.coversDir)
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

  /** 只接受 covers/ 下的文件名（传绝对路径会自动收敛），返回前拼回绝对路径供渲染层使用 */
  setBookCover(id: string, coverPath: string): void {
    const fileName = toCoverFileName(coverPath)
    const result = this.db
      .prepare(`UPDATE books SET cover_path = ? WHERE id = ?`)
      .run(fileName, id)
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
    return toBookSummary(row, this.coversDir)
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

  /**
   * 任意日期区间的阅读统计。
   *
   * 只加一条 SELECT，不改表结构；区间内的逐日明细按日期升序返回。
   */
  statsRange(fromDate: string, toDate: string): StatsRange {
    const rows = this.db
      .prepare(
        `SELECT date, duration_ms, char_count
         FROM reading_stats WHERE date BETWEEN ? AND ? ORDER BY date ASC`
      )
      .all(fromDate, toDate) as Array<{
      date: string
      duration_ms: number
      char_count: number
    }>

    return buildStatsRange(
      rows.map((row) => ({
        date: row.date,
        durationMs: row.duration_ms,
        charCount: row.char_count
      })),
      fromDate,
      toDate
    )
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
      this.listPasswords().map((entry) => `${entry.title}\u0000${entry.account}`)
    )
    let imported = 0
    for (const draft of drafts) {
      const title = normalizeTitle(draft.title, '')
      if (!title || title === '未命名') continue
      const account = draft.account.trim()
      const key = `${title}\u0000${account}`
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
        if (secret.account) keys.add(`${row.title}\u0000${secret.account}`)
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

  // ==================== 待办 ====================

  listTodos(query: TodoQuery): { items: TodoView[]; total: number } {
    const now = Date.now()
    const today = new Date(now)
    today.setHours(0, 0, 0, 0)
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)
    const params = {
      ...query,
      focusId: query.focusId ?? null,
      now,
      dayStart: today.getTime(),
      dayEnd: tomorrow.getTime()
    }
    const rows = this.db
      .prepare(
        `
      SELECT *, COUNT(*) OVER() AS total FROM todos
      WHERE (@search = '' OR instr(lower(title || ' ' || details), lower(@search)) > 0)
        AND (@focusId IS NULL OR id = @focusId)
        AND (@focusId IS NOT NULL OR (@filter = 'archived' AND archived_at_ms IS NOT NULL)
          OR (archived_at_ms IS NULL AND (
            (@filter = 'all' AND completed_at_ms IS NULL)
            OR (@filter = 'completed' AND completed_at_ms IS NOT NULL)
            OR (completed_at_ms IS NULL AND (
              (@filter = 'today' AND ((start_at_ms >= @dayStart AND start_at_ms < @dayEnd)
                OR (due_at_ms >= @dayStart AND due_at_ms < @dayEnd)))
              OR (@filter = 'upcoming' AND start_at_ms > @now)
              OR (@filter = 'overdue' AND due_at_ms < @now))))))
      ORDER BY CASE priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END,
        COALESCE(due_at_ms, start_at_ms, 253402300799999), created_at_ms DESC, id
      LIMIT @limit OFFSET @offset
    `
      )
      .all(params) as Array<TodoRow & { total: number }>
    // 删除／归档后当前页可能已不存在，回到第一页获取真实总数。
    if (!rows.length && query.offset > 0)
      return { items: [], total: this.listTodos({ ...query, offset: 0, limit: 1 }).total }
    return { items: rows.map(toTodo), total: rows[0]?.total ?? 0 }
  }

  saveTodo(input: TodoInput): TodoView {
    const now = Date.now()
    const id = input.id ?? randomUUID()
    if (input.id) {
      const result = this.db
        .prepare(
          `UPDATE todos SET title = ?, details = ?, priority = ?,
        start_at_ms = ?, due_at_ms = ?, remind = ?, updated_at_ms = ? WHERE id = ?`
        )
        .run(
          input.title,
          input.details,
          input.priority,
          input.startAtMs,
          input.dueAtMs,
          input.remind ? 1 : 0,
          now,
          id
        )
      if (!result.changes) throw new Error('待办不存在，请刷新列表')
    } else {
      this.db
        .prepare(
          `INSERT INTO todos (id, title, details, priority, start_at_ms, due_at_ms, remind, created_at_ms, updated_at_ms)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          id,
          input.title,
          input.details,
          input.priority,
          input.startAtMs,
          input.dueAtMs,
          input.remind ? 1 : 0,
          now,
          now
        )
    }
    const row = this.db.prepare('SELECT * FROM todos WHERE id = ?').get(id) as TodoRow
    return toTodo(row)
  }

  completeTodo(id: string, completed: boolean): void {
    const now = Date.now()
    const result = this.db
      .prepare('UPDATE todos SET completed_at_ms = ?, updated_at_ms = ? WHERE id = ?')
      .run(completed ? now : null, now, id)
    if (!result.changes) throw new Error('待办不存在，请刷新列表')
  }

  archiveTodo(id: string, archived: boolean): void {
    const now = Date.now()
    const result = this.db
      .prepare('UPDATE todos SET archived_at_ms = ?, updated_at_ms = ? WHERE id = ?')
      .run(archived ? now : null, now, id)
    if (!result.changes) throw new Error('待办不存在，请刷新列表')
  }

  pendingTodoReminders(now: number): TodoReminder[] {
    const rows = this.db
      .prepare(
        `SELECT id, title, start_at_ms AS startAtMs, due_at_ms AS dueAtMs,
      start_notified_for_ms AS startNotifiedForMs, due_notified_for_ms AS dueNotifiedForMs
      FROM todos WHERE remind = 1 AND completed_at_ms IS NULL AND archived_at_ms IS NULL
        AND ((due_at_ms <= ? AND due_notified_for_ms IS NOT due_at_ms)
          OR (start_at_ms <= ? AND start_notified_for_ms IS NOT start_at_ms AND (due_at_ms IS NULL OR due_at_ms > ?)))
      ORDER BY COALESCE(due_at_ms, start_at_ms), id LIMIT 200`
      )
      .all(now, now, now) as TodoReminderCandidate[]
    return rows.flatMap((row) => {
      const reminder = dueTodoReminder(row, now)
      return reminder ? [reminder] : []
    })
  }

  markTodoReminders(reminders: TodoReminder[]): void {
    this.db.transaction(() => {
      const start = this.db.prepare(`UPDATE todos SET start_notified_for_ms = ?
        WHERE id = ? AND start_at_ms = ? AND remind = 1 AND completed_at_ms IS NULL AND archived_at_ms IS NULL`)
      const due = this.db
        .prepare(`UPDATE todos SET due_notified_for_ms = ?, start_notified_for_ms = start_at_ms
        WHERE id = ? AND due_at_ms = ? AND remind = 1 AND completed_at_ms IS NULL AND archived_at_ms IS NULL`)
      for (const item of reminders) {
        if (item.kind === 'start') start.run(item.atMs, item.id, item.atMs)
        else due.run(item.atMs, item.id, item.atMs)
      }
    })()
  }

  // ==================== 本地知识库 ====================

  /** 列表只回摘要；绝对路径转成文件名，避免把本机目录带到界面上。 */
  listKbDocuments(input: KbListInput = {}, embeddingModel = ''): KbDocumentView[] {
    const category = input.category ?? ''
    const status = input.status ?? ''
    const keyword = input.query?.trim() ?? ''
    const pattern = keyword ? `%${escapeLike(keyword)}%` : ''
    const rows = this.db
      .prepare(
        `SELECT ${KB_DOCUMENT_COLUMNS}
         FROM kb_documents
         WHERE (? = '' OR category = ?)
           AND (? = '' OR status = ?)
           AND (? = '' OR title LIKE ? ESCAPE '\\')
         ORDER BY updated_at_ms DESC`
      )
      .all(
        embeddingModel,
        embeddingModel,
        category,
        category,
        status,
        status,
        pattern,
        pattern
      ) as KbDocumentRow[]
    return rows.map(toKbDocument)
  }

  getKbDocument(id: string, embeddingModel = ''): KbDocumentView | null {
    const row = this.db
      .prepare(`SELECT ${KB_DOCUMENT_COLUMNS} FROM kb_documents WHERE id = ?`)
      .get(embeddingModel, embeddingModel, id) as KbDocumentRow | undefined
    return row ? toKbDocument(row) : null
  }

  /** 重建与删除需要源文件位置；只在主进程内使用，不跨 IPC。 */
  kbDocumentSourcePath(id: string): string | null {
    const row = this.db.prepare('SELECT source_path FROM kb_documents WHERE id = ?').get(id) as
      | { source_path: string }
      | undefined
    return row?.source_path ?? null
  }

  findKbDocumentBySha(sha256: string, embeddingModel = ''): KbDocumentView | null {
    const row = this.db
      .prepare(`SELECT ${KB_DOCUMENT_COLUMNS} FROM kb_documents WHERE sha256 = ?`)
      .get(embeddingModel, embeddingModel, sha256) as KbDocumentRow | undefined
    return row ? toKbDocument(row) : null
  }

  countKbDocuments(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS count FROM kb_documents').get() as {
      count: number
    }
    return row.count
  }

  countKbChunks(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS count FROM kb_chunks').get() as {
      count: number
    }
    return row.count
  }

  kbCreateDocument(input: KbDocumentInput): void {
    this.db
      .prepare(
        `INSERT INTO kb_documents
          (id, title, category, source_path, file_size, sha256, status, chunk_count, error,
           created_at_ms, updated_at_ms)
         VALUES (?, ?, ?, ?, ?, ?, 'pending', 0, '', ?, ?)`
      )
      .run(
        input.id,
        input.title,
        input.category,
        input.sourcePath,
        input.fileSize,
        input.sha256,
        input.createdAtMs,
        input.updatedAtMs
      )
  }

  kbUpdateDocumentSource(id: string, input: KbDocumentSourceInput): void {
    const result = this.db
      .prepare(
        `UPDATE kb_documents
         SET title = ?, file_size = ?, sha256 = ?, updated_at_ms = ?
         WHERE id = ?`
      )
      .run(input.title, input.fileSize, input.sha256, input.updatedAtMs, id)
    if (!result.changes) throw new Error('资料不存在，请刷新列表')
  }

  kbSetDocumentStatus(
    id: string,
    status: KbDocumentStatus,
    chunkCount: number,
    error: string
  ): void {
    const result = this.db
      .prepare(
        `UPDATE kb_documents
         SET status = ?, chunk_count = ?, error = ?, updated_at_ms = ?
         WHERE id = ?`
      )
      .run(status, chunkCount, error, Date.now(), id)
    if (!result.changes) throw new Error('资料不存在，请刷新列表')
  }

  /**
   * 整篇替换分块与 FTS 行（重建、首次索引用同一路径）。
   * 先按 chunk_id 删旧 FTS 行，再删主表：FTS 是独立虚表，没有级联。
   */
  kbReplaceChunks(documentId: string, chunks: KbChunkInput[]): void {
    this.db.transaction(() => {
      const existing = this.db
        .prepare('SELECT id FROM kb_chunks WHERE document_id = ?')
        .all(documentId) as Array<{ id: string }>
      const deleteFts = this.db.prepare('DELETE FROM kb_chunks_fts WHERE chunk_id = ?')
      for (const row of existing) deleteFts.run(row.id)
      this.db.prepare('DELETE FROM kb_chunks WHERE document_id = ?').run(documentId)

      const insertChunk = this.db.prepare(
        `INSERT INTO kb_chunks
          (id, document_id, ordinal, heading, content, start_offset, char_count, tokens)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      const insertFts = this.db.prepare(
        'INSERT INTO kb_chunks_fts (chunk_id, tokens, heading) VALUES (?, ?, ?)'
      )
      for (const chunk of chunks) {
        insertChunk.run(
          chunk.id,
          documentId,
          chunk.ordinal,
          chunk.heading,
          chunk.content,
          chunk.startOffset,
          chunk.charCount,
          chunk.tokens
        )
        insertFts.run(chunk.id, chunk.tokens, chunk.heading)
      }
    })()
  }

  listKbChunkPreviews(documentId: string): KbChunkPreview[] {
    const rows = this.db
      .prepare(
        `SELECT id, ordinal, heading, char_count, start_offset,
                substr(content, 1, 600) AS preview
         FROM kb_chunks WHERE document_id = ? ORDER BY ordinal`
      )
      .all(documentId) as KbChunkPreviewRow[]
    return rows.map((row) => ({
      id: row.id,
      ordinal: row.ordinal,
      heading: row.heading,
      charCount: row.char_count,
      startOffset: row.start_offset,
      preview: row.preview
    }))
  }

  hasKbChunk(documentId: string, chunkId: string): boolean {
    return Boolean(
      this.db
        .prepare('SELECT 1 FROM kb_chunks WHERE document_id = ? AND id = ?')
        .get(documentId, chunkId)
    )
  }

  deleteKbDocument(id: string): void {
    this.db.transaction(() => {
      const existing = this.db
        .prepare('SELECT id FROM kb_chunks WHERE document_id = ?')
        .all(id) as Array<{ id: string }>
      const deleteFts = this.db.prepare('DELETE FROM kb_chunks_fts WHERE chunk_id = ?')
      for (const row of existing) deleteFts.run(row.id)
      this.db.prepare('DELETE FROM kb_chunks WHERE document_id = ?').run(id)
      const result = this.db.prepare('DELETE FROM kb_documents WHERE id = ?').run(id)
      if (!result.changes) throw new Error('资料不存在，请刷新列表')
    })()
  }

  /** 关键词检索；match 由 kb-tokenize 生成，禁止拼接用户原文。 */
  searchKbChunks(input: { match: string; limit: number; category?: string }): KbSearchHit[] {
    const category = input.category ?? ''
    const rows = this.db
      .prepare(
        `SELECT c.id AS chunk_id, c.document_id, c.ordinal, c.heading, c.content,
                c.start_offset, c.char_count, d.title AS document_title, d.category,
                bm25(kb_chunks_fts, 0.0, 1.0, 2.0) AS score
         FROM kb_chunks_fts
         JOIN kb_chunks c ON c.id = kb_chunks_fts.chunk_id
         JOIN kb_documents d ON d.id = c.document_id
         WHERE kb_chunks_fts MATCH ? AND (? = '' OR d.category = ?)
         ORDER BY score
         LIMIT ?`
      )
      .all(input.match, category, category, input.limit) as KbSearchRow[]
    return rows.map(toKbSearchHit)
  }

  /** 单个汉字查询的兜底：二元组索引覆盖不到时按内容扫描。 */
  searchKbChunksByText(text: string, limit: number, category = ''): KbSearchHit[] {
    const rows = this.db
      .prepare(
        `SELECT c.id AS chunk_id, c.document_id, c.ordinal, c.heading, c.content,
                c.start_offset, c.char_count, d.title AS document_title, d.category,
                0.0 AS score
         FROM kb_chunks c
         JOIN kb_documents d ON d.id = c.document_id
         WHERE c.content LIKE ? ESCAPE '\\' AND (? = '' OR d.category = ?)
         ORDER BY c.document_id, c.ordinal
         LIMIT ?`
      )
      .all(`%${escapeLike(text)}%`, category, category, limit) as KbSearchRow[]
    return rows.map(toKbSearchHit)
  }

  /** 待向量化的块：还没有向量，或向量来自另一个模型（换模型后需要重算）。 */
  kbPendingEmbeddingChunks(model: string, documentId = ''): KbEmbeddingChunkRow[] {
    return this.db
      .prepare(
        `SELECT id, heading, content FROM kb_chunks
         WHERE (embedding IS NULL OR embedding_model <> ?)
           AND (? = '' OR document_id = ?)
         ORDER BY document_id, ordinal`
      )
      .all(model, documentId, documentId) as KbEmbeddingChunkRow[]
  }

  kbSetChunkEmbeddings(rows: KbChunkEmbeddingInput[]): void {
    if (rows.length === 0) return
    const update = this.db.prepare(
      'UPDATE kb_chunks SET embedding = ?, embedding_model = ?, embedding_dim = ? WHERE id = ?'
    )
    this.db.transaction(() => {
      for (const row of rows) update.run(row.embedding, row.model, row.dim, row.id)
    })()
  }

  /** 语义检索的向量索引：只含元数据与 BLOB，正文在命中后再取。 */
  kbLoadVectorIndex(model: string): KbVectorIndexRow[] {
    return this.db
      .prepare(
        `SELECT c.id AS chunk_id, c.document_id, c.ordinal, c.heading, c.char_count,
                c.start_offset, c.embedding, d.title AS document_title, d.category
         FROM kb_chunks c
         JOIN kb_documents d ON d.id = c.document_id
         WHERE c.embedding IS NOT NULL AND c.embedding_model = ?`
      )
      .all(model) as KbVectorIndexRow[]
  }

  kbCountVectors(model: string): number {
    const row = this.db
      .prepare('SELECT COUNT(*) AS count FROM kb_chunks WHERE embedding_model = ? AND embedding IS NOT NULL')
      .get(model) as { count: number }
    return row.count
  }

  /** 语义命中后按 id 取完整片段（含正文），供预算截断与引用。 */
  kbGetChunkHit(chunkId: string): KbSearchHit | null {
    const row = this.db
      .prepare(
        `SELECT c.id AS chunk_id, c.document_id, c.ordinal, c.heading, c.content,
                c.start_offset, c.char_count, d.title AS document_title, d.category,
                0.0 AS score
         FROM kb_chunks c
         JOIN kb_documents d ON d.id = c.document_id
         WHERE c.id = ?`
      )
      .get(chunkId) as KbSearchRow | undefined
    return row ? toKbSearchHit(row) : null
  }

  /** 向量化失败只记录提示，不把整篇资料标成失败（关键词仍可用）。 */
  kbSetDocumentError(id: string, error: string): void {
    this.db
      .prepare('UPDATE kb_documents SET error = ?, updated_at_ms = ? WHERE id = ?')
      .run(error, Date.now(), id)
  }

  // ==================== 生命周期 ====================

  /** SQLite 在线备份 API 会处理 WAL，不能直接复制正在使用的数据库文件。 */
  async backupTo(path: string): Promise<number> {
    await this.db.backup(path)
    // 只把独立快照改成单文件日志模式，避免只读校验在目标目录留下 WAL/SHM。
    const snapshot = new Database(path, { fileMustExist: true })
    try {
      snapshot.pragma('journal_mode = DELETE')
      return snapshot.pragma('user_version', { simple: true }) as number
    } finally { snapshot.close() }
  }

  /** 恢复前只读检查独立快照，失败不得触碰当前数据库。 */
  static inspectSnapshot(path: string): number {
    const database = new Database(path, { readonly: true, fileMustExist: true })
    try {
      if (database.pragma('quick_check', { simple: true }) !== 'ok') throw new Error('快照数据库损坏')
      const version = database.pragma('user_version', { simple: true }) as number
      if (version < 1 || version > SCHEMA_VERSION) throw new Error('快照数据库版本不受支持')
      // 固定 SQL 白名单验证该版本业务会读取的核心表与字段，不只相信 user_version。
      const checks: Array<[number, string]> = [
        [1, 'SELECT id, title, created_at_ms, updated_at_ms FROM conversations LIMIT 0'],
        [1, 'SELECT id, conversation_id, role, content, created_at_ms FROM messages LIMIT 0'],
        [2, 'SELECT id, title, created_at_ms, updated_at_ms FROM books LIMIT 0'],
        [2, 'SELECT id, book_id, idx, title, body, word_count FROM chapters LIMIT 0'],
        [2, 'SELECT book_id, chapter_idx, updated_at_ms FROM reading_progress LIMIT 0'],
        [2, 'SELECT id, title, url, secret, is_favorite, created_at_ms, updated_at_ms FROM password_entries LIMIT 0'],
        [2, 'SELECT id, title, content, created_at_ms, updated_at_ms FROM notes LIMIT 0'],
        [3, 'SELECT author, cover_path, sort_index, group_id FROM books LIMIT 0'],
        [3, 'SELECT percent FROM reading_progress LIMIT 0'],
        [3, 'SELECT first_letter FROM password_entries LIMIT 0'],
        [3, 'SELECT key, value FROM kv LIMIT 0'],
        [3, 'SELECT id, name, sort_index FROM book_groups LIMIT 0'],
        [3, 'SELECT id, book_id, chapter_idx, page_idx, page_idx_ratio, snippet, created_at_ms FROM bookmarks LIMIT 0'],
        [3, 'SELECT date, duration_ms, char_count FROM reading_stats LIMIT 0'],
        [5, 'SELECT id, title, details, priority, start_at_ms, due_at_ms, remind, completed_at_ms, archived_at_ms, start_notified_for_ms, due_notified_for_ms, created_at_ms, updated_at_ms FROM todos LIMIT 0'],
        [6, 'SELECT id, title, category, source_path, file_size, sha256, status, chunk_count, error, created_at_ms, updated_at_ms FROM kb_documents LIMIT 0'],
        [6, 'SELECT id, document_id, ordinal, heading, content, start_offset, char_count, tokens FROM kb_chunks LIMIT 0'],
        [7, 'SELECT id, conversation_id, summary, covered_message_id, covered_message_count, omitted_message_count, summary_tokens, source_tokens, model, created_at_ms FROM conversation_checkpoints LIMIT 0']
      ]
      for (const [minimum, sql] of checks) {
        if (version >= minimum) database.prepare(sql).all()
      }
      return version
    } finally { database.close() }
  }

  close(): void {
    if (this.db.open) this.db.close()
  }

  // ==================== 迁移 ====================

  private migrate(): void {
    const current = this.db.pragma('user_version', { simple: true }) as number
    if (current >= SCHEMA_VERSION) return

    if (current > 0 && current < SCHEMA_VERSION && this.dbPath !== ':memory:') {
      const backupDir = join(dirname(this.dbPath), 'backups')
      // VACUUM INTO 生成含 WAL 已提交内容的一致快照，不覆盖已有备份。
      try {
        mkdirSync(backupDir, { recursive: true })
        this.db
          .prepare('VACUUM INTO ?')
          .run(
            join(
              backupDir,
              `toolbox-before-v${SCHEMA_VERSION}-${Date.now()}-${randomUUID()}.db`
            )
          )
      } catch {
        throw new Error('升级前数据库备份失败，请检查磁盘空间和数据目录权限')
      }
    }
    this.db.transaction(() => this.applyMigrations(current))()
  }

  private applyMigrations(current: number): void {
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

    if (current < 4) {
      // v3 → v4：封面路径由绝对路径收敛为 covers/ 下的文件名。
      // 绝对路径会在换机、目录搬迁后失效；文件名 + 运行时拼接则始终有效。
      // 顺带清理指向已丢失文件的封面，避免书架出现破图。已是文件名的行跳过 → 幂等。
      const rows = this.db
        .prepare(`SELECT id, cover_path FROM books WHERE cover_path != ''`)
        .all() as Array<{ id: string; cover_path: string }>
      const update = this.db.prepare(`UPDATE books SET cover_path = ? WHERE id = ?`)

      this.db.transaction(() => {
        for (const row of rows) {
          const fileName = toCoverFileName(row.cover_path)
          if (!fileName) continue
          if (!existsSync(join(this.coversDir, fileName))) {
            // 封面文件已丢失：置空，让书架回落到占位图而不是显示破图
            update.run('', row.id)
            continue
          }
          if (fileName !== row.cover_path) update.run(fileName, row.id)
        }
      })()
    }

    if (current < 5) {
      this.db.exec(`CREATE TABLE IF NOT EXISTS todos (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, details TEXT NOT NULL DEFAULT '',
        priority TEXT NOT NULL DEFAULT 'normal' CHECK(priority IN ('low', 'normal', 'high')),
        start_at_ms INTEGER, due_at_ms INTEGER, remind INTEGER NOT NULL DEFAULT 1 CHECK(remind IN (0, 1)),
        completed_at_ms INTEGER, archived_at_ms INTEGER,
        start_notified_for_ms INTEGER, due_notified_for_ms INTEGER,
        created_at_ms INTEGER NOT NULL, updated_at_ms INTEGER NOT NULL,
        CHECK(start_at_ms IS NULL OR due_at_ms IS NULL OR start_at_ms <= due_at_ms)
      );
      CREATE INDEX IF NOT EXISTS idx_todos_reminders ON todos(remind, completed_at_ms, archived_at_ms, due_at_ms, start_at_ms);
      CREATE INDEX IF NOT EXISTS idx_todos_status ON todos(archived_at_ms, completed_at_ms, priority);`)
    }

    if (current < 6) {
      // v5 → v6：本地知识库。只新增表与虚表，不修改既有表与加密链路。
      // FTS 列顺序固定为 chunk_id / tokens / heading：bm25 的权重按列位置传参。
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS kb_documents (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          category TEXT NOT NULL DEFAULT 'work',
          source_path TEXT NOT NULL,
          file_size INTEGER NOT NULL DEFAULT 0,
          sha256 TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          chunk_count INTEGER NOT NULL DEFAULT 0,
          error TEXT NOT NULL DEFAULT '',
          created_at_ms INTEGER NOT NULL,
          updated_at_ms INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_kb_documents_category
          ON kb_documents(category, updated_at_ms DESC);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_kb_documents_sha ON kb_documents(sha256);

        CREATE TABLE IF NOT EXISTS kb_chunks (
          id TEXT PRIMARY KEY,
          document_id TEXT NOT NULL,
          ordinal INTEGER NOT NULL,
          heading TEXT NOT NULL DEFAULT '',
          content TEXT NOT NULL,
          start_offset INTEGER NOT NULL DEFAULT 0,
          char_count INTEGER NOT NULL DEFAULT 0,
          tokens TEXT NOT NULL DEFAULT '',
          embedding BLOB,
          embedding_model TEXT NOT NULL DEFAULT '',
          embedding_dim INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_kb_chunks_document ON kb_chunks(document_id, ordinal);
        CREATE INDEX IF NOT EXISTS idx_kb_chunks_pending ON kb_chunks(document_id, ordinal)
          WHERE embedding IS NULL;

        CREATE VIRTUAL TABLE IF NOT EXISTS kb_chunks_fts USING fts5(
          chunk_id UNINDEXED,
          tokens,
          heading,
          tokenize = 'unicode61 remove_diacritics 2'
        );`)
    }

    if (current < 7) {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS conversation_checkpoints (
          id TEXT PRIMARY KEY,
          conversation_id TEXT NOT NULL,
          summary TEXT NOT NULL,
          covered_message_id TEXT NOT NULL,
          covered_message_count INTEGER NOT NULL,
          omitted_message_count INTEGER NOT NULL DEFAULT 0,
          summary_tokens INTEGER NOT NULL,
          source_tokens INTEGER NOT NULL,
          model TEXT NOT NULL,
          created_at_ms INTEGER NOT NULL,
          FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_conversation_checkpoints_conversation
          ON conversation_checkpoints(conversation_id, created_at_ms DESC);
      `)
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

function toKbDocument(row: KbDocumentRow): KbDocumentView {
  return {
    id: row.id,
    title: row.title,
    category: row.category,
    fileName: basename(row.source_path.replaceAll('\\', '/')),
    fileSize: row.file_size,
    status: isKbDocumentStatus(row.status) ? row.status : 'failed',
    chunkCount: row.chunk_count,
    embeddedChunkCount: row.embedded_chunk_count,
    error: row.error,
    createdAtMs: row.created_at_ms,
    updatedAtMs: row.updated_at_ms
  }
}

function toKbSearchHit(row: KbSearchRow): KbSearchHit {
  return {
    chunkId: row.chunk_id,
    documentId: row.document_id,
    documentTitle: row.document_title,
    category: row.category,
    heading: row.heading,
    ordinal: row.ordinal,
    charCount: row.char_count,
    content: row.content,
    startOffset: row.start_offset,
    score: row.score
  }
}

/** LIKE 里的通配符必须转义，否则用户输入的 % 会匹配整库。 */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`)
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
  row: BookRow & { cover_path: string; sort_index: number; group_id: string | null },
  coversDir: string
): BookSummary {
  return {
    id: row.id,
    title: row.title,
    author: row.author,
    chapterCount: row.chapter_count ?? 0,
    // 库里只存文件名，这里拼回绝对路径，渲染层无需感知存储细节
    coverPath: row.cover_path ? join(coversDir, row.cover_path) : '',
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

/**
 * 封面路径归一：绝对路径 / 带分隔符的相对路径 → 纯文件名。
 * 已是纯文件名时原样返回，保证迁移可重入。
 */
export function toCoverFileName(input: string): string {
  const trimmed = input.trim()
  if (!trimmed) return ''
  return basename(trimmed.replaceAll('\\', '/'))
}

export { DECRYPT_FAIL_NOTE, firstLetterOf, pinyinFirstLetter }
