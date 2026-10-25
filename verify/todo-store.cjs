/* 真实 Electron ABI / SQLite 的隔离验收，不接触用户数据库或系统通知。 */
/* global __filename:readonly */
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const { Module } = require('node:module')

if (!process.versions.electron) {
  const result = spawnSync(require('electron'), [__filename], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: 'inherit'
  })
  process.exitCode = result.status ?? 1
} else {
  const Database = require('better-sqlite3')
  const { buildSync } = require('esbuild')
  const output = buildSync({
    entryPoints: [path.join(__dirname, '../src/main/services/chat-store/chat-store.ts')],
    platform: 'node',
    format: 'cjs',
    bundle: true,
    write: false,
    external: ['better-sqlite3']
  })
  const compiled = new Module(__filename)
  compiled.paths = module.paths
  compiled._compile(output.outputFiles[0].text, __filename)
  const { ToolboxStore } = compiled.exports
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'toolbox-todos-'))
  const dbPath = path.join(root, 'toolbox.db')
  let store, legacy
  try {
    legacy = new Database(dbPath)
    legacy.pragma('journal_mode = WAL')
    legacy.exec(
      'CREATE TABLE notes (id TEXT PRIMARY KEY, title TEXT NOT NULL, content TEXT NOT NULL, created_at_ms INTEGER, updated_at_ms INTEGER); PRAGMA user_version = 4'
    )
    legacy
      .prepare('INSERT INTO notes VALUES (?, ?, ?, ?, ?)')
      .run('old', '原笔记', 'WAL 中的合成记录', 1, 1)
    const box = {
      encrypt: () => {
        throw new Error('本验收不使用加密')
      },
      decrypt: () => {
        throw new Error('本验收不使用解密')
      }
    }
    store = new ToolboxStore(dbPath, box)
    const backups = fs.readdirSync(path.join(root, 'backups'))
    assert.equal(backups.length, 1)
    const backup = new Database(path.join(root, 'backups', backups[0]), { readonly: true })
    assert.equal(backup.pragma('user_version', { simple: true }), 4)
    assert.equal(backup.prepare('SELECT count(*) AS n FROM notes').get().n, 1)
    assert.equal(
      backup.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name = 'todos'").get().n,
      0
    )
    backup.close()
    assert.equal(legacy.pragma('user_version', { simple: true }), 5)
    assert.equal(store.listNotes()[0].title, '原笔记')
    legacy.close()
    legacy = null
    process.stdout.write('PASS v4→v5 一致备份包含 WAL，旧数据保留，备份可回滚\n')
    const now = Date.now()
    const base = {
      title: '提醒事项',
      details: "备注 ' % _",
      priority: 'normal',
      startAtMs: now - 1000,
      dueAtMs: now + 60000,
      remind: true
    }
    const item = store.saveTodo(base)
    const query = { filter: 'all', search: '', offset: 0, limit: 30 }
    assert.equal(store.listTodos(query).total, 1)
    assert.equal(store.listTodos({ ...query, search: "' % _" }).total, 1)
    const start = store.pendingTodoReminders(now)
    assert.equal(start[0].kind, 'start')
    store.markTodoReminders(start)
    assert.equal(store.pendingTodoReminders(now).length, 0)
    store.saveTodo({ ...item, title: '仅改标题' })
    assert.equal(store.pendingTodoReminders(now).length, 0)
    assert.equal(store.pendingTodoReminders(now + 60000)[0].kind, 'due')
    store.completeTodo(item.id, true)
    assert.equal(store.pendingTodoReminders(now + 60000).length, 0)
    assert.equal(store.listTodos({ ...query, filter: 'completed' }).total, 1)
    store.completeTodo(item.id, false)
    store.archiveTodo(item.id, true)
    assert.equal(store.pendingTodoReminders(now + 60000).length, 0)
    assert.equal(store.listTodos({ ...query, filter: 'archived' }).total, 1)
    store.archiveTodo(item.id, false)
    store.saveTodo({ ...item, remind: false })
    assert.equal(store.pendingTodoReminders(now + 60000).length, 0)
    store.saveTodo({ ...item, dueAtMs: now - 1 })
    const due = store.pendingTodoReminders(now)
    assert.equal(due[0].kind, 'due')
    store.markTodoReminders(due)
    assert.equal(store.pendingTodoReminders(now).length, 0)
    process.stdout.write('PASS 开始／截止去重、修改备注、完成／重开、归档／恢复、关闭提醒\n')
    const changed = store.saveTodo({ ...item, dueAtMs: now + 2000 })
    store.markTodoReminders(due)
    assert.equal(store.pendingTodoReminders(now + 2000)[0].atMs, changed.dueAtMs)
    assert.equal(store.listTodos({ ...query, filter: 'overdue' }).total, 0)
    assert.equal(store.listTodos({ ...query, filter: 'today' }).total, 1)
    assert.equal(store.listTodos({ ...query, offset: 100 }).total, 1)
    store.archiveTodo(item.id, true)
    assert.equal(store.listTodos({ ...query, focusId: item.id }).items[0].id, item.id)
    store.close()
    store = new ToolboxStore(dbPath, box)
    assert.equal(store.listTodos({ ...query, filter: 'archived' }).total, 1)
    assert.equal(fs.readdirSync(path.join(root, 'backups')).length, 1)
    process.stdout.write('PASS 通知时间竞态、筛选／分页／通知定位、重启与迁移幂等\n')
    store.close()
    store = null
    const failureDir = path.join(root, 'failure')
    fs.mkdirSync(failureDir)
    const failureDb = new Database(path.join(failureDir, 'toolbox.db'))
    failureDb.pragma('user_version = 4')
    failureDb.close()
    fs.writeFileSync(path.join(failureDir, 'backups'), '阻止创建备份目录')
    assert.throws(() => new ToolboxStore(path.join(failureDir, 'toolbox.db'), box), /备份失败/)
    const unchanged = new Database(path.join(failureDir, 'toolbox.db'))
    assert.equal(unchanged.pragma('user_version', { simple: true }), 4)
    unchanged.close()
    process.stdout.write('PASS 备份失败终止升级并释放数据库连接\n')
  } finally {
    store?.close()
    legacy?.close()
    if (
      path.dirname(path.resolve(root)) === path.resolve(os.tmpdir()) &&
      path.basename(root).startsWith('toolbox-todos-')
    )
      fs.rmSync(root, { recursive: true, force: true })
  }
}
