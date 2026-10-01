import { Directory, Paths } from 'expo-file-system'
import { openDatabaseAsync } from 'expo-sqlite'
import type { SQLiteDatabase } from 'expo-sqlite'

import { DB_FILE_NAME } from './constants'
import { COLUMN_PATCHES_V3, SCHEMA_VERSION, collectMigrationSql } from './schema'

/**
 * 手机端数据库入口。
 *
 * 与桌面端同等约束：WAL 日志、外键开启、按 user_version 分段迁移、幂等可重入。
 * 差异仅在于 expo-sqlite 只提供异步 API，因此所有数据层方法都是 async。
 * 事务包装见 transaction.ts（单独成文件以免把原生模块带进纯函数测试）。
 */

/** 数据库所在目录（沙盒 document 目录，等价于桌面端 userData） */
export function databaseDirectory(): Directory {
  return new Directory(Paths.document)
}

export function databaseFilePath(): string {
  return databaseDirectory().createFile(DB_FILE_NAME, null).uri
}

/** 打开数据库并执行迁移，返回可用的 SQLiteDatabase */
export async function openDatabase(): Promise<SQLiteDatabase> {
  const db = await openDatabaseAsync(databaseFilePath())
  await db.execAsync('PRAGMA journal_mode = WAL;')
  await db.execAsync('PRAGMA foreign_keys = ON;')
  await migrate(db)
  return db
}

/**
 * 事务包装已移至 transaction.ts。
 */

async function migrate(db: SQLiteDatabase): Promise<void> {
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version')
  const current = Number(row?.user_version ?? 0)
  if (current >= SCHEMA_VERSION) return

  for (const sql of collectMigrationSql(current)) {
    await db.execAsync(sql)
  }

  // SQLite 不支持 ADD COLUMN IF NOT EXISTS，需先查列是否存在
  for (const patch of current < 3 ? COLUMN_PATCHES_V3 : []) {
    const columns = await tableColumns(db, patch.table)
    if (!columns.includes(patch.column)) await db.execAsync(patch.ddl)
  }

  await db.execAsync(`PRAGMA user_version = ${SCHEMA_VERSION}`)
}

async function tableColumns(db: SQLiteDatabase, table: string): Promise<string[]> {
  const rows = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${table})`)
  return rows.map((item) => item.name)
}