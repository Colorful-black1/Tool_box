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
import { AI_SETTINGS_MASTER_KEY } from '../src/data/constants'
import { SCHEMA_VERSION } from '../src/data/schema'
import { unpackEnvelope } from '../src/data/secret-envelope'
import { AiSettingsService } from '../src/ai/ai-settings'
import { AiGateway } from '../src/ai/ai-gateway'
import type { ChatEventSink } from '../src/ai/ai-gateway'
import { buildChatHeaders as buildMobileChatHeaders } from '../src/ai/provider-headers'
import {
  buildProviderHeaders as buildDesktopHeaders,
  requiresCustomUserAgent as desktopNeedsCustomUa
} from '../../src/main/services/ai-gateway/provider-headers'

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

/** 轮询等待后台流到达终态 */
async function waitUntil(predicate: () => boolean, timeoutMs = 5000): Promise<boolean> {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return true
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  return predicate()
}
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

  // ---------- 8. AI 链路 ----------
  section('8. AI 链路（真实 AES-GCM + 真实 SQLite）')

  // 交叉校验：手机端与桌面端对「哪些供应商要会话头」的判定必须一致，
  // 否则同一份配置在两端表现会分叉。
  const providers = ['deepseek', 'glm', 'mimo', 'openai', 'opencode-go', 'kimi', 'qwen', 'siliconflow', 'custom'] as const
  const urls = [
    'https://api.deepseek.com/v1',
    'https://opencode.ai/zen/go/v1',
    'https://opencode.ai/zen/v1',
    'https://opencode.ai/v1',
    'https://my-proxy.example.com/v1'
  ]
  let headerMismatch = 0
  for (const provider of providers) {
    for (const baseUrl of urls) {
      // 桌面端的 requiresSessionHeader 未导出，用 buildProviderHeaders 是否含该头来等价判断
      const desktopNeedsSession = Object.hasOwn(
        buildDesktopHeaders({ provider, baseUrl, sessionId: 's' }),
        'x-opencode-session'
      )
      const mobile = buildMobileChatHeaders({
        provider,
        baseUrl,
        apiKey: 'sk-x',
        sessionId: 's'
      })
      if (desktopNeedsSession !== Object.hasOwn(mobile, 'x-opencode-session')) headerMismatch += 1
      // 需要会话头的供应商两端都必须改写 UA
      if (desktopNeedsCustomUa({ provider, baseUrl, sessionId: 's' }) !== Object.hasOwn(mobile, 'User-Agent')) {
        headerMismatch += 1
      }
    }
  }
  check('会话头与 User-Agent 判定与桌面端完全一致', headerMismatch === 0)

  const goHeaders = buildDesktopHeaders({ provider: 'opencode-go', baseUrl: 'https://opencode.ai/zen/go/v1', sessionId: 'sess-1' })
  const goMobile = buildMobileChatHeaders({
    provider: 'opencode-go',
    baseUrl: 'https://opencode.ai/zen/go/v1',
    apiKey: 'sk-x',
    sessionId: 'sess-1'
  })
  check(
    'OpenCode Go 会话头两端取值相同',
    goHeaders['x-opencode-session'] === 'sess-1' && goMobile['x-opencode-session'] === 'sess-1'
  )
  check('手机端用自有 User-Agent', goMobile['User-Agent'] === 'tool-box-mobile')

  const plainHeaders = buildMobileChatHeaders({
    provider: 'deepseek',
    baseUrl: 'https://api.deepseek.com/v1',
    apiKey: 'sk-x',
    sessionId: 's'
  })
  check('普通供应商不带额外头', plainHeaders['x-opencode-session'] === undefined)

  // AI 配置：Key 必须真加密落库
  const aiBox = new SecureStoreSecretBox(AI_SETTINGS_MASTER_KEY)
  const aiSettings = new AiSettingsService(store, aiBox, () => randomUUID())

  const aiView = await aiSettings.save({
    name: '验证档案',
    provider: 'deepseek',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-v4-pro',
    apiKey: 'sk-verify-key-123456'
  })
  check('AI 档案已保存', aiView.profiles.length === 1)
  check('脱敏视图只暴露 hasApiKey', aiView.profiles[0]?.hasApiKey === true)

  const storedAi = await store.kvGet('ai_settings')
  check('AI 配置落库不含明文 Key', !(storedAi ?? '').includes('sk-verify-key-123456'))

  // apiKeyCipher 是被 JSON.stringify 转义过的嵌套 JSON 字符串，必须解析后校验字段
  let envelopeOk: boolean
  try {
    const parsed = JSON.parse(storedAi ?? '{}') as {
      profiles?: Array<{ apiKeyCipher?: string }>
    }
    const cipher = parsed.profiles?.[0]?.apiKeyCipher ?? ''
    const envelope = JSON.parse(cipher) as Record<string, unknown>
    const iv = envelope['iv']
    const tag = envelope['tag']
    const data = envelope['data']
    envelopeOk =
      envelope['v'] === 1 &&
      typeof iv === 'string' &&
      iv.length > 0 &&
      typeof tag === 'string' &&
      tag.length > 0 &&
      typeof data === 'string' &&
      data.length > 0
  } catch {
    envelopeOk = false
  }
  check('AI Key 以标准 AES-GCM 信封落库', envelopeOk)

  const activeConfig = await aiSettings.getActiveConfig()
  check('启用档案能解出明文 Key', activeConfig.apiKey === 'sk-verify-key-123456')

  // 流式对话：真 SSE 文本喂进去，验证落库与增量
  const sseText =
    `data: ${JSON.stringify({ choices: [{ delta: { content: '流' } }] })}\n\n` +
    `data: ${JSON.stringify({ choices: [{ delta: { content: '式' } }] })}\n\n` +
    `data: ${JSON.stringify({ choices: [{ delta: { role: 'assistant' } }] })}\n\n` +
    `data: ${JSON.stringify({ choices: [{ delta: { content: '回复' } }] })}\n\n` +
    `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\n` +
    'data: [DONE]\n\n'

  const fakeFetch = (): Promise<Response> => {
    const bytes = new TextEncoder().encode(sseText)
    let index = 0
    return Promise.resolve({
      ok: true,
      status: 200,
      body: {
        getReader: () => ({
          read: () => {
            if (index >= bytes.length) return Promise.resolve({ done: true, value: undefined })
            const value = bytes.slice(index, index + 5)
            index += 5
            return Promise.resolve({ done: false, value })
          },
          cancel: () => Promise.resolve()
        })
      }
    } as unknown as Response)
  }

  const aiConversation = await store.createConversation()
  const gateway = new AiGateway(aiSettings, store, fakeFetch, 5000)
  const deltas: string[] = []
  const state = { completed: false, stopped: false }
  let errored = ''
  const sink: ChatEventSink = {
    onDelta: (event) => deltas.push(event.delta),
    onCompleted: () => {
      state.completed = true
    },
    onError: (event) => {
      errored = event.message
    },
    onStopped: () => {}
  }

  await gateway.send(aiConversation.id, '请自检', sink)
  const streamDone = await waitUntil(() => state.completed || errored !== '')
  check('后台流到达终态', streamDone)
  check('流式增量按序到达', deltas.join('') === '流式回复')
  check('空增量被跳过', deltas.length === 3)
  check('流正常完成', state.completed && errored === '')
  check('网关已释放该会话', !gateway.isStreaming(aiConversation.id))

  const aiMessages = await store.listMessages(aiConversation.id)
  check('user 与 assistant 都已落库', aiMessages.length === 2)
  check(
    'assistant 内容为完整累积结果',
    aiMessages[1]?.role === 'assistant' && aiMessages[1]?.content === '流式回复'
  )
  check('首轮自动把内容设为标题', (await store.getConversation(aiConversation.id))?.title === '请自检')

  // 停止语义：active 释放且不落库 assistant
  const stopConversation = await store.createConversation()
  const hangFetch = (): Promise<Response> => {
    const bytes = new TextEncoder().encode(
      `data: ${JSON.stringify({ choices: [{ delta: { content: '半句' } }] })}\n\n`
    )
    let index = 0
    return Promise.resolve({
      ok: true,
      status: 200,
      body: {
        getReader: () => ({
          read: () => {
            if (index >= bytes.length) return Promise.resolve({ done: true, value: undefined })
            const value = bytes.slice(index, index + 3)
            index += 3
            return Promise.resolve({ done: false, value })
          },
          cancel: () => Promise.resolve()
        })
      }
    } as unknown as Response)
  }

  const stopGateway = new AiGateway(aiSettings, store, hangFetch, 5000)
  await stopGateway.send(stopConversation.id, '要停止', {
    onDelta: () => {},
    onCompleted: () => {},
    onError: (event) => say(`  意外错误：${event.message}`),
    onStopped: () => {
      state.stopped = true
    }
  })
  stopGateway.stop(stopConversation.id)
  check('停止后到达终态', await waitUntil(() => state.stopped))
  check('用户停止走 stopped 而非 error', state.stopped)
  check('停止后不落库 assistant 消息', (await store.listMessages(stopConversation.id)).length === 1)
  check('停止后 active 已释放', !stopGateway.isStreaming(stopConversation.id))

  // 收尾：验证全部跑完再关库
  db.close()

  console.log(`\n通过 ${passed} 项，失败 ${failed} 项`)
  say(`\n通过 ${passed} 项，失败 ${failed} 项`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((error) => {
  say(`\n验证脚本异常：${String(error)}`)
  process.exit(1)
})
