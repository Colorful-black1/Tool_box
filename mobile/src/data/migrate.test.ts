import { describe, expect, it } from 'vitest'

import { migrateUp, readUserVersion } from './migrate'
import type { SqlExecutor } from './migrate'

/**
 * 迁移编排逻辑测试（不碰真实 SQLite）。
 *
 * 真实 SQLite 上的端到端验证见 mobile/verify/ —— 那套跑在 Electron + better-sqlite3 里，
 * 因为手机端的 expo-sqlite 是原生模块，vitest 的 node 环境装不了。
 * 这里只负责「执行了哪几段、补丁有没有被重复执行」这类编排逻辑。
 */
function createRecorder(options: { userVersion?: number; existingColumns?: string[] } = {}) {
  const executed: string[] = []
  const existing = new Set(options.existingColumns ?? [])

  const executor: SqlExecutor = {
    exec: async (sql) => {
      executed.push(sql)
    },
    all: async <T,>(sql: string) => {
      if (sql.startsWith('PRAGMA user_version')) {
        return [{ user_version: options.userVersion ?? 0 } as T]
      }
      if (sql.startsWith('PRAGMA table_info')) {
        return [...existing].map((name) => ({ name }) as T)
      }
      return [] as T[]
    }
  }

  return { executor, executed, existing }
}

describe('readUserVersion', () => {
  it('读出当前版本', async () => {
    const { executor } = createRecorder({ userVersion: 3 })
    expect(await readUserVersion(executor)).toBe(3)
  })

  it('读不到时按新库返回 0', async () => {
    const executor: SqlExecutor = { exec: async () => {}, all: async () => [] }
    expect(await readUserVersion(executor)).toBe(0)
  })
})

describe('migrateUp', () => {
  it('新库执行三段建表语句并写入目标版本', async () => {
    const { executor, executed } = createRecorder({ userVersion: 0 })

    // 每段 DDL 是一次 exec 调用，内含多条 CREATE TABLE
    expect(await migrateUp(executor, 0)).toBe(3)
    const blocks = executed.filter((sql) => sql.includes('CREATE TABLE'))
    expect(blocks).toHaveLength(3)
    // 11 张表：conversations/messages/books/chapters/reading_progress/
    // password_entries/notes/kv/book_groups/bookmarks/reading_stats
    const tableCount = blocks
      .join('\n')
      .split('CREATE TABLE IF NOT EXISTS').length
    expect(tableCount - 1).toBe(11)
    expect(executed.at(-1)).toBe('PRAGMA user_version = 4')
  })

  it('建表语句里不含 ALTER TABLE（否则新库会因重复列失败）', async () => {
    const { executor, executed } = createRecorder({ userVersion: 0 })
    await migrateUp(executor, 0)

    const ddl = executed.filter((sql) => sql.includes('CREATE'))
    expect(ddl.some((sql) => sql.includes('ALTER TABLE'))).toBe(false)
  })

  it('已达目标版本时什么都不做', async () => {
    const { executor, executed } = createRecorder({ userVersion: 4 })

    expect(await migrateUp(executor, 4)).toBe(0)
    expect(executed).toHaveLength(0)
  })

  it('v2 旧库缺列时才补 ALTER，且每条只补一次', async () => {
    const { executor, executed } = createRecorder({ userVersion: 2 })

    expect(await migrateUp(executor, 2)).toBe(1)
    const alters = executed.filter((sql) => sql.startsWith('ALTER TABLE'))
    expect(alters).toHaveLength(7)
    expect(new Set(alters).size).toBe(7)
  })

  it('v2 旧库列已齐全时一条 ALTER 都不执行', async () => {
    const { executor, executed } = createRecorder({
      userVersion: 2,
      existingColumns: ['author', 'cover_path', 'sort_index', 'group_id', 'percent', 'first_letter', 'page_idx_ratio']
    })

    await migrateUp(executor, 2)
    expect(executed.filter((sql) => sql.startsWith('ALTER TABLE'))).toHaveLength(0)
    expect(executed.at(-1)).toBe('PRAGMA user_version = 4')
  })
})
