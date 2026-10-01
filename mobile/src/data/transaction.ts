import type { SQLiteDatabase } from 'expo-sqlite'

/**
 * 事务包装。
 *
 * 单独成文件是刻意的：这里只需要 SQLiteDatabase 的**类型**（编译后被擦除），
 * 因此 store.ts 不会因此在运行期引入 expo-sqlite，
 * 纯函数部分（行映射、归一化）才能在 vitest 的 node 环境里直接测试。
 *
 * expo-sqlite 的 withTransactionAsync 会丢弃回调返回值，所以这里只接受无返回值的任务；
 * 需要结果时在事务结束后再查询。与桌面端一致：多表写入必须走这里。
 */
export async function transact(db: SQLiteDatabase, task: () => Promise<void>): Promise<void> {
  await db.withTransactionAsync(task)
}