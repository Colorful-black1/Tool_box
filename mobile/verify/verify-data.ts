/**
 * M1 端到端验证：用真实 SQLite（better-sqlite3）+ 真实 AES-256-GCM（WebCrypto）
 * 跑通手机端数据层的全部逻辑。只 shim 掉 expo-sqlite / expo-crypto / expo-secure-store
 * 这三个原生绑定，schema、迁移、MobileStore、secret-box 全部是真实代码。
 */
import { randomUUID } from 'node:crypto'
import { appendFileSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

import { ShimDatabase } from './shims/expo-sqlite'
import { migrateUp, readUserVersion } from '../src/data/migrate'
import { MobileStore } from '../src/data/store'
import { SecureStoreSecretBox } from '../src/data/secret-box'
import { SCHEMA_VERSION } from '../src/data/schema'
import { unpackEnvelope } from '../src/data/secret-envelope'

/**
 * 输出目录由 run.cjs 通过 VERIFY_OUT_DIR 传入。
 * 不能用 __dirname：打包产物本身就落在 .out 里，__dirname 会多嵌一层。
 */
const OUT_DIR = process.env['VERIFY_OUT_DIR'] ?? join(__dirname, '.out')
const LOG = join(OUT_DIR, 'verify.log')
const DB_DIR = join(OUT_DIR, 'db')

// .out 的清理由 run.cjs 负责（不能删掉正在运行的 bundle），但日志与数据库每次必须重置
rmSync(LOG, { force: true })
rmSync(DB_DIR, { recursive: true, force: true })
mkdirSync(DB_DIR, { recursive: true })

/** 直接落盘，避免 Electron 下 stdout 重定向丢日志 */
function say(line: string): void {
  appendFileSync(LOG, `${line}\n`, 'utf8')
}

let passed = 0
let failed = 0

function check(label: string, condition: boolean, detail = ''): void {
  if (condition) {
    passed += 1
    say(`  PASS  ${label}`)
  } else {
    failed += 1
    say(`  FAIL  ${label}${detail ? ` -> ${detail}` : ''}`)
  }
}

function section(title: string): void {
  say(`\n=== ${title} ===`)
}

/** 断言「应当抛错」，返回是否确实抛了 */
async function throws(run: () => Promise<unknown>): Promise<boolean> {
  try {
    await run()
    return false
  } catch {
    return true
  }
}

const DB_PATH = join(DB_DIR, 'toolbox.db')

async function main(): Promise<void> {
  // ---------- 1. 建库与迁移 ----------
  section('1. 建库与迁移')
  const db = new ShimDatabase(DB_PATH)
  const executor = {
    exec: (sql: string) => db.execAsync(sql),
    all: <T,>(sql: string) => db.getAllAsync<T>(sql)
  }

  const before = await readUserVersion(executor)
  check('新库 user_version 初始为 0', before === 0, String(before))

  const executed = await migrateUp(executor, before)
  check('首次迁移执行了 3 段建表语句', executed === 3, String(executed))

  const after = await readUserVersion(executor)
  check(`迁移后 user_version = ${SCHEMA_VERSION}`, after === SCHEMA_VERSION, String(after))

  const tables = (
    await db.getAllAsync<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`
    )
  ).map((row) => row.name)
  check('建出 11 张表', tables.length === 11, tables.join(','))

  // ---------- 2. 迁移幂等 ----------
  section('2. 迁移幂等（重复启动）')
  const again = await migrateUp(executor, await readUserVersion(executor))
  check('已是目标版本时不再执行任何语句', again === 0, String(again))

  // 从 v2 库升级到 v4，验证列补丁与幂等
  const legacyPath = join(DB_DIR, 'legacy.db')
  const legacy = new ShimDatabase(legacyPath)
  const legacyExecutor = {
    exec: (sql: string) => legacy.execAsync(sql),
    all: <T,>(sql: string) => legacy.getAllAsync<T>(sql)
  }
  // 造一个 v2 形态的库：只有 v1+v2 的表，缺 v3 新增的列
  await legacy.execAsync(
    `CREATE TABLE books (id TEXT PRIMARY KEY, title TEXT NOT NULL, created_at_ms INTEGER NOT NULL, updated_at_ms INTEGER NOT NULL);
     CREATE TABLE reading_progress (id TEXT PRIMARY KEY, book_id TEXT UNIQUE NOT NULL, chapter_idx INTEGER NOT NULL, updated_at_ms INTEGER NOT NULL);
     CREATE TABLE password_entries (id TEXT PRIMARY KEY, title TEXT NOT NULL, url TEXT NOT NULL DEFAULT '', secret TEXT NOT NULL, created_at_ms INTEGER NOT NULL, updated_at_ms INTEGER NOT NULL);
     CREATE TABLE bookmarks (id TEXT PRIMARY KEY, book_id TEXT NOT NULL, chapter_idx INTEGER NOT NULL, page_idx INTEGER NOT NULL, snippet TEXT NOT NULL DEFAULT '', created_at_ms INTEGER NOT NULL);`
  )
  await legacy.execAsync('PRAGMA user_version = 2')
  await migrateUp(legacyExecutor, 2)
  const legacyVersion = await readUserVersion(legacyExecutor)
  check('v2 库升级到 v4', legacyVersion === SCHEMA_VERSION, String(legacyVersion))
  const patched = (
    await legacy.getAllAsync<{ name: string }>('PRAGMA table_info(books)')
  ).map((row) => row.name)
  check(
    'v2→v4 补齐 books.author / cover_path / sort_index / group_id',
    ['author', 'cover_path', 'sort_index', 'group_id'].every((column) =>
      patched.includes(column)
    ),
    patched.join(',')
  )
  legacy.close()

  // ---------- 3. 业务 SQL ----------
  section('3. 业务 SQL（真实 SQLite）')
  const secretBox = new SecureStoreSecretBox()
  const store = new MobileStore(db as never, secretBox, randomUUID)

  const conversation = await store.createConversation()
  check('创建会话', conversation.title === '新对话')
  check('首个会话自动启用', (await store.listConversations()).length === 1)

  const message = await store.appendMessage({
    conversationId: conversation.id,
    role: 'user',
    content: '你好'
  })
  check('追加消息', message.role === 'user')
  const messages = await store.listMessages(conversation.id)
  check('读取消息列表', messages.length === 1 && messages[0].content === '你好')
  const renamed = await store.renameConversation(conversation.id, '改名后的会话')
  check('重命名会话', renamed.title === '改名后的会话')
  check(
    '消息数聚合正确',
    (await store.getConversation(conversation.id))?.messageCount === 1
  )

  const book = await store.importBook({
    title: '测试小说',
    author: '作者',
    chapters: [
      { title: '第一章', body: '正文内容'.repeat(20) },
      { title: '第二章', body: '更多正文'.repeat(20) }
    ]
  })
  check('导入书籍', book.title === '测试小说' && book.chapterCount === 2)

  const chapters = await store.listChapters(book.id)
  check('读取章节列表', chapters.length === 2 && chapters[1].title === '第二章')
  const content = await store.chapterContent(chapters[0].id)
  check('读取章节正文', content.content.includes('正文内容'))

  await store.progressSave({ bookId: book.id, chapterIdx: 1, percent: 0.4 })
  const progress = await store.progressGet(book.id)
  check('保存并读取进度', progress?.chapterIdx === 1 && progress?.percent === 0.4)
  await store.progressSave({ bookId: book.id, chapterIdx: 1, percent: 0.9 })
  const progress2 = await store.progressGet(book.id)
  check('进度二次写入走 UPDATE 分支', progress2?.percent === 0.9)

  const updated = await store.updateBookMeta(book.id, { author: '新作者' })
  check('更新书籍元信息', updated.author === '新作者')

  const group = await store.createGroup('测试分组')
  check('创建分组', group.name === '测试分组')
  await store.setBooksGroup([book.id], group.id)
  check('设置书籍分组', (await store.getBook(book.id)).groupId === group.id)

  const bookmark = await store.toggleBookmark({
    bookId: book.id,
    chapterIdx: 0,
    pageIdx: 3,
    pageIdxRatio: 0.25,
    snippet: '书签片段'
  })
  check('添加书签', bookmark.active === true)
  const bookmarks = await store.listBookmarks(book.id)
  check('读取书签', bookmarks.length === 1 && bookmarks[0].pageIdx === 3)
  const untoggled = await store.toggleBookmark({
    bookId: book.id,
    chapterIdx: 0,
    pageIdx: 3,
    pageIdxRatio: 0.25,
    snippet: '书签片段'
  })
  check('再次切换同一页签会移除', untoggled.active === false)

  await store.addStatsToday(60_000, 500)
  await store.addStatsToday(30_000, 200)
  const stats = await store.statsSummary()
  check('阅读统计累加', stats.todayDurationMs === 90_000 && stats.totalCharCount === 700)

  await store.configSet({ fontSize: 21, nightMode: true })
  const config = await store.configGet()
  check('kv 配置读写', config?.fontSize === 21 && config?.nightMode === true)
  await store.configSet({ fontSize: 22 })
  check('kv 配置为增量合并', (await store.configGet())?.nightMode === true)

  const note = await store.saveNote({ title: '笔记', content: '内容' })
  check('保存笔记', note.title === '笔记')
  const noteUpdated = await store.saveNote({ id: note.id, title: '笔记2', content: '内容2' })
  check('更新笔记且保留创建时间', noteUpdated.createdAtMs === note.createdAtMs)
  check('读取笔记列表', (await store.listNotes()).length === 1)

  // ---------- 4. 密码箱加密 ----------
  section('4. 密码箱加密（AES-256-GCM 往返）')
  const payload = { account: 'me@example.com', password: 'p@ss 中文', remark: '备注' }
  const cipherText = await secretBox.encrypt(payload)
  const envelope = unpackEnvelope(cipherText)
  check('信封 iv 为 12 字节', envelope.iv.length === 12, String(envelope.iv.length))
  check('信封 tag 为 16 字节', envelope.tag.length === 16, String(envelope.tag.length))
  check('信封字段与桌面端一致', Object.keys(JSON.parse(cipherText)).sort().join(',') === 'data,iv,tag,v')
  const decrypted = await secretBox.decrypt(cipherText)
  check('解密还原明文（含中文）', JSON.stringify(decrypted) === JSON.stringify(payload))

  const second = await secretBox.encrypt(payload)
  check('两次加密的 iv 不同（随机 IV）', second !== cipherText)

  await store.savePassword({
    title: 'GitHub',
    url: 'https://github.com',
    account: 'me@example.com',
    password: 'p@ss',
    remark: '工作'
  })
  const entries = await store.listPasswords()
  check('保存并读取密码条目', entries.length === 1 && entries[0].password === 'p@ss')
  check('拼音首字母分组正确', entries[0].firstLetter === 'G', entries[0].firstLetter)
  check('密文未落明文', !(await db.getAllAsync<{ secret: string }>('SELECT secret FROM password_entries'))[0].secret.includes('p@ss'))

  const imported = await store.savePasswordDrafts([
    { title: 'GitHub', url: '', account: 'me@example.com', password: 'dup', remark: '' },
    { title: '新站点', url: '', account: 'other', password: 'x', remark: '' }
  ])
  check('批量导入跳过同名同账号', imported === 1, String(imported))
  check('重复键集合可用', (await store.duplicateKeys()).size === 2)

  // ---------- 5. 事务与级联 ----------
  section('5. 事务与级联删除')
  const groupAfterDelete = await store.listGroups()
  check('分组仍存在', groupAfterDelete.length === 1)
  await store.deleteGroup(group.id)
  check('删除分组', (await store.listGroups()).length === 0)
  check(
    '删除分组会把书籍 group_id 置空而非删书',
    (await store.getBook(book.id)).groupId === null
  )

  // 先放一个书签，才能验证级联清理
  await store.toggleBookmark({
    bookId: book.id,
    chapterIdx: 0,
    pageIdx: 9,
    pageIdxRatio: 0.1,
    snippet: '待级联'
  })
  const noteCountBefore = (await store.listNotes()).length

  await store.deleteBook(book.id)

  // 书籍已删，store 的存在性校验会抛错（与桌面端一致），因此级联用原生 SQL 验证
  const chaptersLeft = await db.getAllAsync<{ n: number }>(
    'SELECT COUNT(*) AS n FROM chapters WHERE book_id = ?',
    book.id
  )
  const bookmarksLeft = await db.getAllAsync<{ n: number }>(
    'SELECT COUNT(*) AS n FROM bookmarks WHERE book_id = ?',
    book.id
  )
  const progressLeft = await db.getAllAsync<{ n: number }>(
    'SELECT COUNT(*) AS n FROM reading_progress WHERE book_id = ?',
    book.id
  )
  check('删除书籍后章节级联清空', chaptersLeft[0].n === 0, String(chaptersLeft[0].n))
  check('删除书籍后书签级联清空', bookmarksLeft[0].n === 0, String(bookmarksLeft[0].n))
  check('删除书籍后进度级联清空', progressLeft[0].n === 0, String(progressLeft[0].n))
  check('删除书籍不影响笔记', (await store.listNotes()).length === noteCountBefore)
  check('删除后再取书籍会抛「书籍不存在」', await throws(() => store.getBook(book.id)))

  // ---------- 6. 错误路径 ----------
  section('6. 错误路径')
  check('不存在的会话改名会抛错', await throws(() => store.renameConversation('nope', 'x')))
  check('不存在的笔记删除会抛错', await throws(() => store.deleteNote('nope')))
  check('空标题的密码会被拒绝', await throws(() => store.savePassword({ title: '   ', url: '', account: '', password: '', remark: '' })))
  check(
    '残缺信封解密会抛「密文格式无效」',
    await throws(async () => secretBox.decrypt('{"v":1,"iv":"","tag":"","data":""}'))
  )
  check('损坏的密文被篡改会解密失败', await throws(async () => {
    const parsed = JSON.parse(cipherText) as { data: string }
    parsed.data = Buffer.from('tampered').toString('base64')
    return secretBox.decrypt(JSON.stringify(parsed))
  }))

  // ---------- 6. 清理 ----------
  section('7. 收尾')
  await store.deleteConversation(conversation.id)
  check('删除会话', (await store.listConversations()).length === 0)
  db.close()

  console.log(`\n通过 ${passed} 项，失败 ${failed} 项`)
  say(`\n通过 ${passed} 项，失败 ${failed} 项`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((error) => {
  say(`\n验证脚本异常：${String(error)}`)
  process.exit(1)
})
