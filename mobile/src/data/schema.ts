/**
 * 手机端 SQLite schema。
 *
 * 与桌面端 `src/main/services/chat-store/chat-store.ts` 的迁移分段**逐段对齐**：
 * 同名表、同名列、同版本号（v4），因此两端数据在结构上可互换（内容仍是各自独立，
 * 且密码箱密文因主密钥绑设备而不互通）。
 *
 * 改动纪律：桌面端改 schema 时必须同步这里，并重新生成
 * `desktop-schema.fixture.json`（从真实 toolbox.db 导出）。`schema.test.ts`
 * 会拿本文件的 DDL 与该基准比对，防止单边改动。
 *
 * 与桌面端唯一的差异：v4 段不做「清理已丢失封面」—— 那是桌面端用 node fs
 * 判断文件是否存在的逻辑，手机端改用 expo-file-system；两端最终状态一致
 * （cover_path 存文件名），差异只在是否顺带清理失效记录。
 */

/** 与桌面端保持一致，改动必须两边同步 */
export const SCHEMA_VERSION = 4

/** v1：AI 会话与消息 */
const SCHEMA_V1 = `
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
      `

/** v2：小说、密码箱、记事本 */
const SCHEMA_V2 = `
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
      `

/** v3：kv 配置、书籍作者/封面/排序/分组、书签、阅读统计 */
const SCHEMA_V3 = `
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
      `

/** v2 早期版本缺失、v3 补齐的列（幂等：已存在则跳过） */
export const COLUMN_PATCHES_V3: Array<{ table: string; column: string; ddl: string }> = [
  { table: 'books', column: 'author', ddl: `ALTER TABLE books ADD COLUMN author TEXT NOT NULL DEFAULT ''` },
  { table: 'books', column: 'cover_path', ddl: `ALTER TABLE books ADD COLUMN cover_path TEXT NOT NULL DEFAULT ''` },
  { table: 'books', column: 'sort_index', ddl: `ALTER TABLE books ADD COLUMN sort_index INTEGER NOT NULL DEFAULT 0` },
  { table: 'books', column: 'group_id', ddl: `ALTER TABLE books ADD COLUMN group_id TEXT` },
  {
    table: 'reading_progress',
    column: 'percent',
    ddl: `ALTER TABLE reading_progress ADD COLUMN percent REAL NOT NULL DEFAULT 0`
  },
  {
    table: 'password_entries',
    column: 'first_letter',
    ddl: `ALTER TABLE password_entries ADD COLUMN first_letter TEXT NOT NULL DEFAULT '#'`
  },
  {
    table: 'bookmarks',
    column: 'page_idx_ratio',
    ddl: `ALTER TABLE bookmarks ADD COLUMN page_idx_ratio REAL NOT NULL DEFAULT 0`
  }
]

/**
 * 按当前版本取出需要执行的 DDL 段。
 * 与桌面端同样的「current < N 分段、幂等可重入」策略。
 */
export function collectMigrationSql(current: number): string[] {
  const statements: string[] = []
  if (current < 1) statements.push(SCHEMA_V1)
  if (current < 2) statements.push(SCHEMA_V2)
  if (current < 3) {
    statements.push(SCHEMA_V3)
    statements.push(...COLUMN_PATCHES_V3.map((patch) => patch.ddl))
  }
  return statements
}

/** 仅供测试与文档参考：完整的期望 schema 文本 */
export const ALL_SCHEMA_SQL = [SCHEMA_V1, SCHEMA_V2, SCHEMA_V3].join('\n')