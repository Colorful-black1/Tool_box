import { COLUMN_PATCHES_V3, SCHEMA_VERSION, collectMigrationSql } from './schema'

/**
 * 迁移执行器。
 *
 * 把 SQL 执行抽象成接口，好处是迁移逻辑不依赖 expo-sqlite 原生模块，
 * 因此可以在 Node 环境里用真实 SQLite（better-sqlite3）跑通并验证，
 * 而不必等到真机才发现 DDL 或分段写错。
 */
export interface SqlExecutor {
  exec(sql: string): Promise<void>
  all<T>(sql: string): Promise<T[]>
}

/** 读当前 schema 版本；新库返回 0 */
export async function readUserVersion(executor: SqlExecutor): Promise<number> {
  const rows = await executor.all<{ user_version: number }>('PRAGMA user_version')
  return Number(rows[0]?.user_version ?? 0)
}

/**
 * 逐段迁移到 SCHEMA_VERSION。
 * 与桌面端同样的策略：current < N 分段、幂等可重入、已达标则直接返回。
 * 返回执行过的建表 / 建索引语句条数（列补丁不计入）。
 */
export async function migrateUp(executor: SqlExecutor, current: number): Promise<number> {
  if (current >= SCHEMA_VERSION) return 0

  const statements = collectMigrationSql(current)
  for (const sql of statements) {
    await executor.exec(sql)
  }

  // SQLite 不支持 ADD COLUMN IF NOT EXISTS，需先查列是否存在
  for (const patch of current < 3 ? COLUMN_PATCHES_V3 : []) {
    const columns = await tableColumns(executor, patch.table)
    if (!columns.includes(patch.column)) await executor.exec(patch.ddl)
  }

  await executor.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`)
  return statements.length
}

async function tableColumns(executor: SqlExecutor, table: string): Promise<string[]> {
  const rows = await executor.all<{ name: string }>(`PRAGMA table_info(${table})`)
  return rows.map((item) => item.name)
}