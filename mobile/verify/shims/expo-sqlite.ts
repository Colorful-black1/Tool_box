/**
 * 验证用 shim：用 better-sqlite3 顶替 expo-sqlite。
 *
 * expo-sqlite 的 runAsync/getAllAsync/getFirstAsync 都是 better-sqlite3 同步 API 的
 * Promise 包装，语义一致；withTransactionAsync 对应 BEGIN/COMMIT。
 * 因此这里能真实执行 MobileStore 的每一条 SQL。
 */
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

import Database from 'better-sqlite3'

export interface RunResult {
  changes: number
  lastInsertRowId: number
}

/** 最小必要接口：MobileStore 与 migrate 用到的部分 */
export class ShimDatabase {
  private readonly db: Database.Database
  private depth = 0

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true })
    this.db = new Database(path)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('foreign_keys = ON')
  }

  async execAsync(sql: string): Promise<void> {
    this.db.exec(sql)
  }

  async runAsync(sql: string, ...params: unknown[]): Promise<RunResult> {
    const result = this.db.prepare(sql).run(...(params as never[]))
    return { changes: result.changes, lastInsertRowId: Number(result.lastInsertRowid) }
  }

  async getFirstAsync<T>(sql: string, ...params: unknown[]): Promise<T | null> {
    const row = this.db.prepare(sql).get(...(params as never[]))
    return (row as T) ?? null
  }

  async getAllAsync<T>(sql: string, ...params: unknown[]): Promise<T[]> {
    return this.db.prepare(sql).all(...(params as never[])) as T[]
  }

  async withTransactionAsync(task: () => Promise<void>): Promise<void> {
    // 嵌套事务用 SAVEPOINT，与 SQLite 语义一致
    const name = `sp_${this.depth}`
    this.db.exec(this.depth === 0 ? 'BEGIN' : `SAVEPOINT ${name}`)
    this.depth += 1
    try {
      await task()
      this.depth -= 1
      this.db.exec(this.depth === 0 ? 'COMMIT' : `RELEASE ${name}`)
    } catch (error) {
      this.depth -= 1
      this.db.exec(this.depth === 0 ? 'ROLLBACK' : `ROLLBACK TO ${name}`)
      throw error
    }
  }

  close(): void {
    this.db.close()
  }
}
