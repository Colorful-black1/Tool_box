import Database from 'better-sqlite3'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { readUsageDatabase } from './sqlite-source'

const roots: string[] = []
async function database(): Promise<{ file: string; db: Database.Database }> {
  const path = await mkdtemp(join(tmpdir(), 'toolbox-usage-db-'))
  roots.push(path)
  const file = join(path, 'fixture.db')
  return { file, db: new Database(file) }
}
afterEach(async () => {
  for (const path of roots.splice(0)) {
    const target = resolve(path)
    if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith('toolbox-usage-db-'))
      throw new Error('拒绝清理非本用例临时目录')
    await rm(target, { recursive: true, force: true })
  }
})

describe('原生数据库只读统计', () => {
  it('MiMo 排除导入消息，同时保留同一会话后续的新请求', async () => {
    const { file, db } = await database()
    db.exec(`CREATE TABLE session(id TEXT,directory TEXT); CREATE TABLE message(id TEXT,session_id TEXT,time_created INTEGER,data TEXT);
      CREATE TABLE claude_import(session_id TEXT,message_ids TEXT);
      INSERT INTO session VALUES('s','/fixture'); INSERT INTO claude_import VALUES('s','["imported"]')`)
    const data = JSON.stringify({
      role: 'assistant',
      tokens: { input: 2, output: 3, reasoning: 1, cache: { read: 10, write: 4 }, total: 20 }
    })
    db.prepare('INSERT INTO message VALUES(?,?,?,?)').run('imported', 's', 100, data)
    db.prepare('INSERT INTO message VALUES(?,?,?,?)').run('native', 's', 100, data)
    db.close()
    const rows = await readUsageDatabase('mimocode', file)
    expect(rows.map((r) => r.id)).toEqual(['native'])
    expect(rows[0].tokens.total).toBe(20)
  })
  it('Copilot CLI 原生请求表与缓存关系可读取，SQLite 时间按 UTC 解释', async () => {
    const { file, db } = await database()
    db.exec(`CREATE TABLE sessions(id TEXT,cwd TEXT);
      CREATE TABLE assistant_usage_events(id INTEGER,session_id TEXT,model TEXT,created_at TEXT,input_tokens INTEGER,output_tokens INTEGER,cache_read_tokens INTEGER,cache_write_tokens INTEGER,reasoning_tokens INTEGER);
      INSERT INTO sessions VALUES('s','/fixture');
      INSERT INTO assistant_usage_events VALUES(1,'s','fixture','2026-10-24 00:00:00',100,20,60,10,5)`)
    db.close()
    const [row] = await readUsageDatabase('copilot', file)
    expect(row.tokens).toMatchObject({ input: 30, output: 20, total: 120 })
    expect(row.time).toBe(Date.parse('2026-10-24T00:00:00Z'))
  })
  it('MCode 请求用量独立读取，未确认的非零推理关系标为不完整', async () => {
    const { file, db } = await database()
    db.exec(`CREATE TABLE local_runtime_sessions(session_id TEXT,workspace_dir TEXT);
      CREATE TABLE local_runtime_token_usage(id INTEGER,session_id TEXT,model TEXT,ts INTEGER,input_tokens INTEGER,output_tokens INTEGER,reasoning_tokens INTEGER,cache_read_tokens INTEGER,cache_write_tokens INTEGER);
      INSERT INTO local_runtime_sessions VALUES('s','/fixture');
      INSERT INTO local_runtime_token_usage VALUES(1,'s','fixture',100,2,3,1,10,4)`)
    db.close()
    const [row] = await readUsageDatabase('mcode', file)
    expect(row.tokens.total).toBe(19)
    expect(row.partial).toBe(true)
  })
  it('OpenCode 新旧表镜像不相加，正文不跨越采集边界', async () => {
    const { file, db } = await database()
    db.exec(`CREATE TABLE session(id TEXT,directory TEXT);
      CREATE TABLE session_v2(id TEXT,directory TEXT);
      CREATE TABLE message(id TEXT,session_id TEXT,time_created INTEGER,data TEXT);
      CREATE TABLE session_message(id TEXT,session_id TEXT,time_created INTEGER,type TEXT,data TEXT);
      INSERT INTO session VALUES('s','/fixture'); INSERT INTO session_v2 VALUES('s','/fixture');`)
    const data = JSON.stringify({
      role: 'assistant',
      content: 'PRIVATE_SENTINEL',
      modelID: 'fixture',
      tokens: { input: 10, output: 5, reasoning: 2, cache: { read: 100, write: 0 } }
    })
    db.prepare('INSERT INTO message VALUES(?,?,?,?)').run('old', 's', 100, data)
    db.prepare('INSERT INTO session_message VALUES(?,?,?,?,?)').run(
      'new',
      's',
      100,
      'assistant',
      data
    )
    db.close()
    const before = await readFile(file)
    const rows = await readUsageDatabase('opencode', file)
    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe('new')
    expect(rows[0].tokens.total).toBe(117)
    expect(JSON.stringify(rows)).not.toContain('PRIVATE_SENTINEL')
    expect(await readFile(file)).toEqual(before)
  })
  it('OpenCode 新版模型取对象 id，缓存写入计入总量，花费只读原生字段', async () => {
    const { file, db } = await database()
    db.exec(`CREATE TABLE session_v2(id TEXT,directory TEXT);
      CREATE TABLE session_message(id TEXT,session_id TEXT,time_created INTEGER,type TEXT,data TEXT);
      INSERT INTO session_v2 VALUES('s','/fixture');`)
    const data = JSON.stringify({
      role: 'assistant',
      content: 'PRIVATE_SENTINEL',
      model: { id: 'qwen3.8-27b', providerID: 'opencode-go', variant: 'default' },
      cost: 0.0123,
      tokens: { input: 100, output: 20, reasoning: 7, cache: { read: 300, write: 40 } }
    })
    db.prepare('INSERT INTO session_message VALUES(?,?,?,?,?)').run(
      'new',
      's',
      100,
      'assistant',
      data
    )
    db.close()
    const [row] = await readUsageDatabase('opencode', file)
    expect(row.model).toBe('qwen3.8-27b')
    expect(row.tokens).toMatchObject({
      input: 100,
      output: 20,
      cacheRead: 300,
      cacheWrite: 40,
      total: 467
    })
    expect(row.costUsd).toBe(0.0123)
    expect(row.partial).toBe(false)
    expect(JSON.stringify(row)).not.toContain('PRIVATE_SENTINEL')
  })
  it('OpenAI 系 provider 的推理已含在输出，不重复计入', async () => {
    const { file, db } = await database()
    db.exec(`CREATE TABLE session_v2(id TEXT,directory TEXT);
      CREATE TABLE session_message(id TEXT,session_id TEXT,time_created INTEGER,type TEXT,data TEXT);
      INSERT INTO session_v2 VALUES('s','/fixture');`)
    const data = JSON.stringify({
      role: 'assistant',
      model: { id: 'gpt-fixture', providerID: 'openai' },
      tokens: { input: 100, output: 20, reasoning: 7, cache: { read: 50, write: 0 } }
    })
    db.prepare('INSERT INTO session_message VALUES(?,?,?,?,?)').run(
      'new',
      's',
      100,
      'assistant',
      data
    )
    db.close()
    const [row] = await readUsageDatabase('opencode', file)
    expect(row.tokens.total).toBe(170)
  })
  it('读取活动 WAL 中已提交内容，不包含未提交事务', async () => {
    const { file, db } = await database()
    db.pragma('journal_mode = WAL')
    db.exec(
      `CREATE TABLE session(id TEXT,directory TEXT); CREATE TABLE message(id TEXT,session_id TEXT,time_created INTEGER,data TEXT); INSERT INTO session VALUES('s','/fixture')`
    )
    const data = JSON.stringify({
      role: 'assistant',
      tokens: { input: 1, output: 2, reasoning: 0, cache: { read: 0, write: 0 } }
    })
    db.prepare('INSERT INTO message VALUES(?,?,?,?)').run('committed', 's', 100, data)
    db.exec('BEGIN')
    db.prepare('INSERT INTO message VALUES(?,?,?,?)').run('pending', 's', 100, data)
    try {
      expect((await readUsageDatabase('opencode', file)).map((r) => r.id)).toEqual(['committed'])
    } finally {
      db.exec('ROLLBACK')
      db.close()
    }
  })
  it('ZCode 请求明细不累计 turn_usage 汇总，缓存不重复加', async () => {
    const { file, db } = await database()
    db.exec(`CREATE TABLE session(id TEXT,directory TEXT);
      CREATE TABLE model_usage(id TEXT,session_id TEXT,model_id TEXT,started_at INTEGER,input_tokens INTEGER,output_tokens INTEGER,reasoning_tokens INTEGER,cache_read_input_tokens INTEGER,cache_creation_input_tokens INTEGER,computed_total_tokens INTEGER);
      CREATE TABLE turn_usage(computed_total_tokens INTEGER);
      INSERT INTO session VALUES('s','/fixture'); INSERT INTO model_usage VALUES('r','s','fixture',100,100,20,0,80,0,120);
      INSERT INTO turn_usage VALUES(120)`)
    db.close()
    const rows = await readUsageDatabase('zcode', file)
    expect(rows).toHaveLength(1)
    expect(rows[0].tokens.input).toBe(20)
    expect(rows[0].tokens.total).toBe(120)
  })
})
