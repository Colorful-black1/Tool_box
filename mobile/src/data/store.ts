import type { SQLiteDatabase } from 'expo-sqlite'

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
  StatsRange,
  StatsSummary
} from '../shared-bridge'
import { buildStatsRange, pinyinFirstLetter, todayKey } from '../shared-bridge'
import { DEFAULT_CONVERSATION_TITLE } from './constants'
import type { SecretBox } from './secret-box'
import type { SecretPayload } from './secret-envelope'
import { transact } from './transaction'

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
  cover_path: string
  sort_index: number
  group_id: string | null
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

interface NoteRow {
  id: string
  title: string
  content: string
  created_at_ms: number
  updated_at_ms: number
}

/** 封面文件名 → 渲染层可用的绝对 URI（沙盒内用 file:// URI） */
function coverUri(fileName: string): string {
  return fileName ? `file://${fileName}` : ''
}

const MAX_TITLE_CHARS = 60

/**
 * 手机端数据层，方法名与语义刻意与桌面端 `ToolboxStore` 保持一致，
 * 便于将来做数据互导或同步时一一对应。
 *
 * 与桌面端的差异：
 * - 全部方法 async（expo-sqlite 只有异步 API）；
 * - 封面只存文件名，取出时拼成 file:// URI（手机没有可直接给 <img> 的裸路径）。
 */
export class MobileStore {
  constructor(
    private readonly db: SQLiteDatabase,
    private readonly secretBox: SecretBox,
    private readonly newId: () => string
  ) {}

  // ==================== kv 配置 ====================

  async configGet(): Promise<Record<string, unknown> | null> {
    const row = await this.db.getFirstAsync<{ value: string }>(
      `SELECT value FROM kv WHERE key = 'read_config'`
    )
    if (!row) return null
    try {
      return JSON.parse(row.value) as Record<string, unknown>
    } catch {
      return null
    }
  }

  async configSet(patch: Record<string, unknown>): Promise<Record<string, unknown> | null> {
    const current = (await this.configGet()) ?? {}
    const next = { ...current, ...patch }
    await this.db.runAsync(
      `INSERT INTO kv (key, value) VALUES ('read_config', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      JSON.stringify(next)
    )
    return next
  }

  /** 通用 kv 读写：AI 档案等按 key 存放的配置复用这张表，不必各自建表 */
  async kvGet(key: string): Promise<string | null> {
    const row = await this.db.getFirstAsync<{ value: string }>(
      `SELECT value FROM kv WHERE key = ?`,
      key
    )
    return row?.value ?? null
  }

  async kvSet(key: string, value: string): Promise<void> {
    await this.db.runAsync(
      `INSERT INTO kv (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      key,
      value
    )
  }

  // ==================== AI 会话 ====================

  async listConversations(): Promise<ConversationSummary[]> {
    const rows = await this.db.getAllAsync<ConversationRow>(
      `SELECT c.id, c.title, c.created_at_ms, c.updated_at_ms,
              COUNT(m.id) AS message_count
       FROM conversations c
       LEFT JOIN messages m ON m.conversation_id = c.id
       GROUP BY c.id
       ORDER BY c.updated_at_ms DESC`
    )
    return rows.map(toConversation)
  }

  async getConversation(id: string): Promise<ConversationSummary | null> {
    const row = await this.db.getFirstAsync<ConversationRow>(
      `SELECT c.id, c.title, c.created_at_ms, c.updated_at_ms,
              COUNT(m.id) AS message_count
       FROM conversations c
       LEFT JOIN messages m ON m.conversation_id = c.id
       WHERE c.id = ?
       GROUP BY c.id`,
      id
    )
    return row ? toConversation(row) : null
  }

  async createConversation(title = DEFAULT_CONVERSATION_TITLE): Promise<ConversationSummary> {
    const now = Date.now()
    const id = this.newId()
    await this.db.runAsync(
      `INSERT INTO conversations (id, title, created_at_ms, updated_at_ms) VALUES (?, ?, ?, ?)`,
      id,
      normalizeTitle(title, DEFAULT_CONVERSATION_TITLE),
      now,
      now
    )
    const conversation = await this.getConversation(id)
    if (!conversation) throw new Error('会话创建失败')
    return conversation
  }

  async renameConversation(id: string, title: string): Promise<ConversationSummary> {
    const result = await this.db.runAsync(
      `UPDATE conversations SET title = ?, updated_at_ms = ? WHERE id = ?`,
      normalizeTitle(title),
      Date.now(),
      id
    )
    if (result.changes === 0) throw new Error('会话不存在')
    const conversation = await this.getConversation(id)
    if (!conversation) throw new Error('会话不存在')
    return conversation
  }

  async deleteConversation(id: string): Promise<void> {
    const result = await this.db.runAsync('DELETE FROM conversations WHERE id = ?', id)
    if (result.changes === 0) throw new Error('会话不存在')
  }

  async listMessages(conversationId: string): Promise<ChatMessage[]> {
    await this.requireConversation(conversationId)
    const rows = await this.db.getAllAsync<MessageRow>(
      `SELECT id, conversation_id, role, content, created_at_ms
       FROM messages
       WHERE conversation_id = ?
       ORDER BY created_at_ms ASC, rowid ASC`,
      conversationId
    )
    return rows.map((row) => ({
      id: row.id,
      conversationId: row.conversation_id,
      role: row.role as ChatRole,
      content: row.content,
      createdAtMs: row.created_at_ms
    }))
  }

  async appendMessage(input: {
    conversationId: string
    role: ChatRole
    content: string
  }): Promise<ChatMessage> {
    await this.requireConversation(input.conversationId)
    const now = Date.now()
    const id = this.newId()

    await transact(this.db, async () => {
      await this.db.runAsync(
        `INSERT INTO messages (id, conversation_id, role, content, created_at_ms)
         VALUES (?, ?, ?, ?, ?)`,
        id,
        input.conversationId,
        input.role,
        input.content,
        now
      )
      await this.db.runAsync(
        `UPDATE conversations SET updated_at_ms = ? WHERE id = ?`,
        now,
        input.conversationId
      )
    })

    return {
      id,
      conversationId: input.conversationId,
      role: input.role,
      content: input.content,
      createdAtMs: now
    }
  }

  // ==================== 小说 ====================

  async listBooks(query = ''): Promise<BookSummary[]> {
    const keyword = query.trim()
    const rows = await this.db.getAllAsync<BookRow>(
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
         b.created_at_ms DESC`,
      keyword,
      `%${keyword.toLowerCase()}%`,
      `%${keyword.toLowerCase()}%`
    )
    return rows.map(toBookSummary)
  }

  async importBook(input: {
    title: string
    author: string
    chapters: Array<{ title: string; body: string }>
  }): Promise<BookSummary> {
    if (input.chapters.length === 0) throw new Error('书籍内容为空')
    const now = Date.now()
    const bookId = this.newId()
    const minSort = await this.db.getFirstAsync<{ m: number }>(
      'SELECT COALESCE(MIN(sort_index), 0) AS m FROM books'
    )

    await transact(this.db, async () => {
      await this.db.runAsync(
        `INSERT INTO books (id, title, author, cover_path, sort_index, group_id, created_at_ms, updated_at_ms)
         VALUES (?, ?, ?, '', ?, NULL, ?, ?)`,
        bookId,
        normalizeTitle(input.title),
        input.author.trim(),
        minSort?.m ?? 0,
        now,
        now
      )
      for (const [idx, chapter] of input.chapters.entries()) {
        await this.db.runAsync(
          `INSERT INTO chapters (id, book_id, idx, title, body, word_count)
           VALUES (?, ?, ?, ?, ?, ?)`,
          this.newId(),
          bookId,
          idx,
          normalizeTitle(chapter.title, '正文'),
          chapter.body,
          chapter.body.length
        )
      }
    })

    const book = await this.getBook(bookId)
    return book
  }

  async updateBookMeta(
    id: string,
    meta: { title?: string; author?: string }
  ): Promise<BookSummary> {
    const fields: string[] = []
    const values: Array<string | number> = []
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

    const result = await this.db.runAsync(
      `UPDATE books SET ${fields.join(', ')} WHERE id = ?`,
      values
    )
    if (result.changes === 0) throw new Error('书籍不存在')
    return this.getBook(id)
  }

  async setBookCover(id: string, fileName: string): Promise<void> {
    const result = await this.db.runAsync(
      'UPDATE books SET cover_path = ? WHERE id = ?',
      fileName,
      id
    )
    if (result.changes === 0) throw new Error('书籍不存在')
  }

  async setBooksGroup(ids: string[], groupId: string | null): Promise<void> {
    await transact(this.db, async () => {
      for (const id of ids) {
        await this.db.runAsync('UPDATE books SET group_id = ? WHERE id = ?', groupId, id)
      }
    })
  }

  async reorderBooks(orderedIds: string[]): Promise<void> {
    await transact(this.db, async () => {
      for (const [index, id] of orderedIds.entries()) {
        await this.db.runAsync('UPDATE books SET sort_index = ? WHERE id = ?', index, id)
      }
    })
  }

  async getBook(id: string): Promise<BookSummary> {
    const row = await this.db.getFirstAsync<BookRow>(
      `SELECT b.id, b.title, b.author, b.created_at_ms, b.updated_at_ms,
              b.cover_path, b.sort_index, b.group_id,
              (SELECT COUNT(*) FROM chapters ch WHERE ch.book_id = b.id) AS chapter_count,
              p.chapter_idx AS progress_chapter,
              p.percent AS progress_percent,
              p.updated_at_ms AS progress_updated
       FROM books b
       LEFT JOIN reading_progress p ON p.book_id = b.id
       WHERE b.id = ?`,
      id
    )
    if (!row) throw new Error('书籍不存在')
    return toBookSummary(row)
  }

  async listChapters(bookId: string): Promise<ChapterMeta[]> {
    await this.requireBook(bookId)
    const rows = await this.db.getAllAsync<{
      id: string
      idx: number
      title: string
      word_count: number
    }>(
      `SELECT id, idx, title, word_count FROM chapters WHERE book_id = ? ORDER BY idx ASC`,
      bookId
    )
    return rows.map((row) => ({
      id: row.id,
      idx: row.idx,
      title: row.title,
      wordCount: row.word_count
    }))
  }

  async chapterContent(chapterId: string): Promise<ChapterContent> {
    const row = await this.db.getFirstAsync<{
      id: string
      idx: number
      title: string
      body: string
    }>('SELECT id, idx, title, body FROM chapters WHERE id = ?', chapterId)
    if (!row) throw new Error('章节不存在')
    return { id: row.id, idx: row.idx, title: row.title, content: row.body }
  }

  async progressGet(bookId: string): Promise<{ chapterIdx: number; percent: number } | null> {
    await this.requireBook(bookId)
    const row = await this.db.getFirstAsync<{ chapter_idx: number; percent: number }>(
      'SELECT chapter_idx, percent FROM reading_progress WHERE book_id = ?',
      bookId
    )
    return row ? { chapterIdx: row.chapter_idx, percent: row.percent } : null
  }

  async progressSave(input: ReadingProgressInput): Promise<void> {
    await this.requireBook(input.bookId)
    const now = Date.now()
    const percent = Math.min(1, Math.max(0, input.percent))
    const existing = await this.db.getFirstAsync<{ id: string }>(
      'SELECT id FROM reading_progress WHERE book_id = ?',
      input.bookId
    )

    if (existing) {
      await this.db.runAsync(
        `UPDATE reading_progress
         SET chapter_idx = ?, percent = ?, updated_at_ms = ?
         WHERE id = ?`,
        input.chapterIdx,
        percent,
        now,
        existing.id
      )
      return
    }

    await this.db.runAsync(
      `INSERT INTO reading_progress (id, book_id, chapter_idx, percent, updated_at_ms)
       VALUES (?, ?, ?, ?, ?)`,
      this.newId(),
      input.bookId,
      input.chapterIdx,
      percent,
      now
    )
  }

  async deleteBook(bookId: string): Promise<void> {
    await this.requireBook(bookId)
    await transact(this.db, async () => {
      await this.db.runAsync('DELETE FROM reading_progress WHERE book_id = ?', bookId)
      await this.db.runAsync('DELETE FROM bookmarks WHERE book_id = ?', bookId)
      await this.db.runAsync('DELETE FROM chapters WHERE book_id = ?', bookId)
      await this.db.runAsync('DELETE FROM books WHERE id = ?', bookId)
    })
  }

  // ==================== 分组 ====================

  async listGroups(): Promise<BookGroup[]> {
    const rows = await this.db.getAllAsync<{ id: string; name: string; sort_index: number }>(
      'SELECT id, name, sort_index FROM book_groups ORDER BY sort_index ASC'
    )
    return rows.map((row) => ({ id: row.id, name: row.name, sortIndex: row.sort_index }))
  }

  async createGroup(name: string): Promise<BookGroup> {
    const safeName = name.trim().slice(0, 20)
    if (!safeName) throw new Error('分组名称不能为空')
    const id = this.newId()
    const minSort = await this.db.getFirstAsync<{ m: number }>(
      'SELECT COALESCE(MIN(sort_index), 0) AS m FROM book_groups'
    )
    const sortIndex = (minSort?.m ?? 0) - 1
    await this.db.runAsync(
      'INSERT INTO book_groups (id, name, sort_index) VALUES (?, ?, ?)',
      id,
      safeName,
      sortIndex
    )
    return { id, name: safeName, sortIndex }
  }

  async renameGroup(id: string, name: string): Promise<void> {
    const safeName = name.trim().slice(0, 20)
    if (!safeName) throw new Error('分组名称不能为空')
    const result = await this.db.runAsync(
      'UPDATE book_groups SET name = ? WHERE id = ?',
      safeName,
      id
    )
    if (result.changes === 0) throw new Error('分组不存在')
  }

  async deleteGroup(id: string): Promise<void> {
    await transact(this.db, async () => {
      await this.db.runAsync('UPDATE books SET group_id = NULL WHERE group_id = ?', id)
      const result = await this.db.runAsync('DELETE FROM book_groups WHERE id = ?', id)
      if (result.changes === 0) throw new Error('分组不存在')
    })
  }

  // ==================== 书签 ====================

  async listBookmarks(bookId: string): Promise<Bookmark[]> {
    const rows = await this.db.getAllAsync<{
      id: string
      book_id: string
      chapter_idx: number
      page_idx: number
      page_idx_ratio: number
      snippet: string
      created_at_ms: number
    }>(
      `SELECT id, book_id, chapter_idx, page_idx, page_idx_ratio, snippet, created_at_ms
       FROM bookmarks WHERE book_id = ?
       ORDER BY chapter_idx ASC, page_idx ASC`,
      bookId
    )
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

  /** 幂等键 (book_id, chapter_idx, page_idx)：已存在则删除，返回 { active: false } */
  async toggleBookmark(input: {
    bookId: string
    chapterIdx: number
    pageIdx: number
    pageIdxRatio: number
    snippet: string
  }): Promise<{ active: boolean }> {
    const existing = await this.db.getAllAsync<{ id: string }>(
      `SELECT id FROM bookmarks
       WHERE book_id = ? AND chapter_idx = ? AND page_idx = ?`,
      input.bookId,
      input.chapterIdx,
      input.pageIdx
    )

    if (existing.length > 0) {
      await transact(this.db, async () => {
        for (const row of existing) {
          await this.db.runAsync('DELETE FROM bookmarks WHERE id = ?', row.id)
        }
      })
      return { active: false }
    }

    await this.db.runAsync(
      `INSERT INTO bookmarks
         (id, book_id, chapter_idx, page_idx, page_idx_ratio, snippet, created_at_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      this.newId(),
      input.bookId,
      input.chapterIdx,
      input.pageIdx,
      Math.min(1, Math.max(0, input.pageIdxRatio)),
      input.snippet.slice(0, 60),
      Date.now()
    )
    return { active: true }
  }

  async deleteBookmark(id: string): Promise<void> {
    await this.db.runAsync('DELETE FROM bookmarks WHERE id = ?', id)
  }

  // ==================== 阅读统计 ====================

  async addStatsToday(durationMs: number, charCount: number): Promise<void> {
    if (durationMs <= 0 && charCount <= 0) return
    await this.db.runAsync(
      `INSERT INTO reading_stats (date, duration_ms, char_count)
       VALUES (?, ?, ?)
       ON CONFLICT(date) DO UPDATE SET
         duration_ms = duration_ms + excluded.duration_ms,
         char_count = char_count + excluded.char_count`,
      todayKey(),
      Math.max(0, durationMs),
      Math.max(0, charCount)
    )
  }

  /**
   * 任意日期区间的阅读统计。
   *
   * 只加一条 SELECT，不改表结构；区间内的逐日明细按日期升序返回。
   */
  async statsRange(fromDate: string, toDate: string): Promise<StatsRange> {
    const rows = await this.db.getAllAsync<{
      date: string
      duration_ms: number
      char_count: number
    }>(
      'SELECT date, duration_ms, char_count FROM reading_stats WHERE date BETWEEN ? AND ? ORDER BY date ASC',
      fromDate,
      toDate
    )

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

  async statsSummary(): Promise<StatsSummary> {
    const rows = await this.db.getAllAsync<{
      date: string
      duration_ms: number
      char_count: number
    }>('SELECT date, duration_ms, char_count FROM reading_stats ORDER BY date DESC')

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

  async listPasswords(): Promise<PasswordEntryView[]> {
    const rows = await this.db.getAllAsync<PasswordRow>(
      `SELECT id, title, url, secret, first_letter, is_favorite, created_at_ms, updated_at_ms
       FROM password_entries
       ORDER BY is_favorite DESC, first_letter ASC, updated_at_ms DESC, id DESC`
    )
    return Promise.all(rows.map((row) => this.toPasswordView(row)))
  }

  async savePassword(input: PasswordInput & { id?: string }): Promise<void> {
    const title = normalizeTitle(input.title, '')
    if (!title || title === '未命名') throw new Error('名称不能为空')
    const secret = await this.secretBox.encrypt({
      account: input.account.trim(),
      password: input.password,
      remark: input.remark
    })
    const firstLetter = firstLetterOf(title)
    const updatedAt = input.updatedAtMs ?? Date.now()

    if (input.id) {
      const result = await this.db.runAsync(
        `UPDATE password_entries
         SET title = ?, url = ?, secret = ?, first_letter = ?, updated_at_ms = ?
         WHERE id = ?`,
        title,
        input.url.trim(),
        secret,
        firstLetter,
        updatedAt,
        input.id
      )
      if (result.changes === 0) throw new Error('条目不存在')
      return
    }

    await this.db.runAsync(
      `INSERT INTO password_entries
         (id, title, url, secret, first_letter, is_favorite, created_at_ms, updated_at_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      this.newId(),
      title,
      input.url.trim(),
      secret,
      firstLetter,
      input.isFavorite ? 1 : 0,
      updatedAt,
      updatedAt
    )
  }

  /** 批量导入：跳过与既有条目「同名 + 同账号」的重复项 */
  async savePasswordDrafts(drafts: PasswordDraft[]): Promise<number> {
    const existing = new Set(
      (await this.listPasswords()).map((entry) => `${entry.title} ${entry.account}`)
    )
    let imported = 0
    for (const draft of drafts) {
      const title = normalizeTitle(draft.title, '')
      if (!title || title === '未命名') continue
      const account = draft.account.trim()
      const key = `${title} ${account}`
      if (account && existing.has(key)) continue
      await this.savePassword({
        title,
        url: draft.url,
        account,
        password: draft.password,
        remark: draft.remark,
        updatedAtMs: draft.updatedAtMs ?? Date.now()
      })
      existing.add(key)
      imported += 1
    }
    return imported
  }

  /** 已存在同名同账号的条目集合，用于导入预览标记「已存在」 */
  async duplicateKeys(): Promise<Set<string>> {
    const rows = await this.db.getAllAsync<{ title: string; secret: string }>(
      'SELECT title, secret FROM password_entries'
    )
    const keys = new Set<string>()
    for (const row of rows) {
      try {
        const secret = await this.secretBox.decrypt(row.secret)
        if (secret.account) keys.add(`${row.title} ${secret.account}`)
      } catch {
        /* 解密失败不影响重复判定 */
      }
    }
    return keys
  }

  async deletePassword(id: string): Promise<void> {
    const result = await this.db.runAsync('DELETE FROM password_entries WHERE id = ?', id)
    if (result.changes === 0) throw new Error('条目不存在')
  }

  async setPasswordFavorite(id: string, isFavorite: boolean): Promise<void> {
    const result = await this.db.runAsync(
      'UPDATE password_entries SET is_favorite = ?, updated_at_ms = ? WHERE id = ?',
      isFavorite ? 1 : 0,
      Date.now(),
      id
    )
    if (result.changes === 0) throw new Error('条目不存在')
  }

  private async toPasswordView(row: PasswordRow): Promise<PasswordEntryView> {
    let secret: SecretPayload
    let decrypted = true
    try {
      secret = await this.secretBox.decrypt(row.secret)
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

  async listNotes(): Promise<NoteView[]> {
    const rows = await this.db.getAllAsync<NoteRow>(
      `SELECT id, title, content, created_at_ms, updated_at_ms
       FROM notes ORDER BY updated_at_ms DESC, id DESC`
    )
    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      content: row.content,
      createdAtMs: row.created_at_ms,
      updatedAtMs: row.updated_at_ms
    }))
  }

  async saveNote(input: NoteSaveInput): Promise<NoteView> {
    const now = Date.now()
    const title = input.title.trim()

    if (input.id) {
      const existing = await this.db.getFirstAsync<{ created_at_ms: number }>(
        'SELECT created_at_ms FROM notes WHERE id = ?',
        input.id
      )
      if (!existing) throw new Error('笔记不存在')
      await this.db.runAsync(
        'UPDATE notes SET title = ?, content = ?, updated_at_ms = ? WHERE id = ?',
        title,
        input.content,
        now,
        input.id
      )
      return {
        id: input.id,
        title,
        content: input.content,
        createdAtMs: existing.created_at_ms,
        updatedAtMs: now
      }
    }

    const id = this.newId()
    await this.db.runAsync(
      `INSERT INTO notes (id, title, content, created_at_ms, updated_at_ms)
       VALUES (?, ?, ?, ?, ?)`,
      id,
      title,
      input.content,
      now,
      now
    )
    return { id, title, content: input.content, createdAtMs: now, updatedAtMs: now }
  }

  async deleteNote(id: string): Promise<void> {
    const result = await this.db.runAsync('DELETE FROM notes WHERE id = ?', id)
    if (result.changes === 0) throw new Error('笔记不存在')
  }

  // ==================== 内部校验 ====================

  private async requireConversation(id: string): Promise<void> {
    const row = await this.db.getFirstAsync('SELECT 1 FROM conversations WHERE id = ?', id)
    if (!row) throw new Error('会话不存在')
  }

  private async requireBook(id: string): Promise<void> {
    const row = await this.db.getFirstAsync('SELECT 1 FROM books WHERE id = ?', id)
    if (!row) throw new Error('书籍不存在')
  }
}

const DECRYPT_FAIL_NOTE = '【解密失败：密钥不可用或数据损坏】'

export function normalizeTitle(input: string, fallback = '未命名'): string {
  const title = input.replace(/\s+/g, ' ').trim()
  if (!title) return fallback
  return title.length > MAX_TITLE_CHARS ? `${title.slice(0, MAX_TITLE_CHARS)}…` : title
}

export function toConversation(row: ConversationRow): ConversationSummary {
  return {
    id: row.id,
    title: row.title,
    createdAtMs: row.created_at_ms,
    updatedAtMs: row.updated_at_ms,
    messageCount: row.message_count ?? 0
  }
}

export function toBookSummary(row: BookRow): BookSummary {
  return {
    id: row.id,
    title: row.title,
    author: row.author,
    chapterCount: row.chapter_count ?? 0,
    coverPath: coverUri(row.cover_path),
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
export function firstLetterOf(title: string): string {
  const trimmed = title.trim()
  if (!trimmed) return '#'
  const first = trimmed[0]
  if (/[a-zA-Z]/.test(first)) return first.toUpperCase()
  if ((trimmed.codePointAt(0) ?? 0) >= 0x4e00) return pinyinFirstLetter(trimmed)
  return '#'
}

/** 本地时区的今天（YYYY-MM-DD），实现与桌面端共用 */
export { todayKey } from '../shared-bridge'