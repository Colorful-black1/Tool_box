import { Directory, Paths } from 'expo-file-system'
import { openDatabaseAsync } from 'expo-sqlite'
import type { SQLiteDatabase } from 'expo-sqlite'

import { DB_FILE_NAME } from './constants'
import { migrateUp, readUserVersion } from './migrate'
import type { SqlExecutor } from './migrate'

/**
 * 手机端数据库入口。
 *
 * 与桌面端同等约束：WAL 日志、外键开启、按 user_version 分段迁移、幂等可重入。
 * 差异仅在于 expo-sqlite 只提供异步 API，因此所有数据层方法都是 async。
 * 事务包装见 transaction.ts；迁移逻辑见 migrate.ts（不依赖原生模块，可独立验证）。
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
  const executor = toExecutor(db)
  await db.execAsync('PRAGMA journal_mode = WAL;')
  await db.execAsync('PRAGMA foreign_keys = ON;')
  await migrateUp(executor, await readUserVersion(executor))
  return db
}

/** 把 expo-sqlite 的实例适配成迁移执行器所需的最小接口 */
function toExecutor(db: SQLiteDatabase): SqlExecutor {
  return {
    exec: (sql) => db.execAsync(sql),
    all: <T,>(sql: string) => db.getAllAsync<T>(sql)
  }
}