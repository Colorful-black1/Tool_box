import { describe, expect, it } from 'vitest'

import desktopSchema from './desktop-schema.fixture.json'
import { ALL_SCHEMA_SQL, SCHEMA_VERSION } from './schema'

/**
 * schema 对齐护栏。
 *
 * 基准 desktop-schema.fixture.json 由真实桌面 toolbox.db 导出。
 * 手机端 DDL 若漏表或漏列，这里立刻失败 —— 这是防止两端 schema 单边漂移的唯一自动化手段
 * （桌面端 better-sqlite3 是 Electron ABI，无法在 vitest 里建库做真正比对）。
 */

interface ColumnFixture {
  name: string
  type: string
}

const CONSTRAINT_KEYWORDS = new Set([
  'PRIMARY',
  'FOREIGN',
  'UNIQUE',
  'CHECK',
  'CONSTRAINT'
])

/** 从 DDL 文本里抽出 表名 → 列名[]，仅解析 CREATE TABLE 块的第一段 */
function parseCreateTables(sql: string): Record<string, string[]> {
  const tables: Record<string, string[]> = {}
  const re = /CREATE TABLE IF NOT EXISTS (\w+)\s*\(([\s\S]*?)\n\s*\);/g
  let match = re.exec(sql)
  while (match !== null) {
    const [, tableName, body] = match
    const columns = body
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => line.split(/\s+/)[0])
      .filter((token) => !CONSTRAINT_KEYWORDS.has(token.toUpperCase()))
    tables[tableName] = columns
    match = re.exec(sql)
  }
  return tables
}

describe('手机端 schema 与桌面端对齐', () => {
  const mobileTables = parseCreateTables(ALL_SCHEMA_SQL)

  it('版本号与桌面端一致', () => {
    expect(SCHEMA_VERSION).toBe(desktopSchema.user_version)
  })

  it('桌面端的每一张表都在手机端 DDL 中存在', () => {
    const expected = Object.keys(desktopSchema.tables)
    expect(expected.length).toBeGreaterThan(0)
    for (const table of expected) {
      expect(Object.keys(mobileTables)).toContain(table)
    }
  })

  it('手机端没有多余的历史表', () => {
    expect(Object.keys(mobileTables).sort()).toEqual(Object.keys(desktopSchema.tables).sort())
  })

  it('每一张表的列与桌面端完全一致', () => {
    for (const [table, columns] of Object.entries(desktopSchema.tables)) {
      const expectedColumns = (columns as ColumnFixture[]).map((column) => column.name)
      expect({ table, columns: mobileTables[table] }).toEqual({ table, columns: expectedColumns })
    }
  })
})

describe('迁移分段', () => {
  it('版本越高，需要执行的语句越少（v1/v2/v3 三段 DDL + 7 条列补丁）', async () => {
    const { collectMigrationSql } = await import('./schema')

    expect(collectMigrationSql(0)).toHaveLength(10)
    expect(collectMigrationSql(1)).toHaveLength(9)
    expect(collectMigrationSql(2)).toHaveLength(8)
  })

  it('已是 v3 或更高则不再执行任何语句', async () => {
    const { collectMigrationSql } = await import('./schema')

    expect(collectMigrationSql(3)).toHaveLength(0)
    expect(collectMigrationSql(4)).toHaveLength(0)
    expect(collectMigrationSql(99)).toHaveLength(0)
  })

  it('v2→v3 段包含 7 条列补丁，且都是 ADD COLUMN', async () => {
    const { COLUMN_PATCHES_V3 } = await import('./schema')

    expect(COLUMN_PATCHES_V3).toHaveLength(7)
    for (const patch of COLUMN_PATCHES_V3) {
      expect(patch.ddl.startsWith('ALTER TABLE')).toBe(true)
      expect(patch.ddl).toContain(patch.table)
      expect(patch.ddl).toContain(patch.column)
    }
  })
})