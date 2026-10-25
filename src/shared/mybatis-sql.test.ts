import { describe, expect, it } from 'vitest'
import { replaceSqlParameters, restoreMyBatisSql } from './mybatis-sql'

describe('MyBatis SQL 还原', () => {
  it('保留长整数、逗号、空字符串和引号', () => {
    const result = restoreMyBatisSql(
      "==> Preparing: SELECT ?, ?, ?, ?, ?\n==> Parameters: 9007199254740993(Long), a,b(String), O'Reilly(String), (String), null",
      'sqlite'
    )
    expect(result[0].sql).toBe("SELECT 9007199254740993, 'a,b', 'O''Reilly', '', NULL")
  })
  it('不替换字符串、标识符和注释中的问号', () => {
    expect(
      replaceSqlParameters('SELECT \'?\', "?", `?`, [?], ? /* ? */ -- ?\n', ['1'], 'sqlite')
    ).toBe('SELECT \'?\', "?", `?`, [?], 1 /* ? */ -- ?\n')
    expect(replaceSqlParameters('SELECT $tag$?$tag$, ?', ['2'], 'postgresql')).toBe(
      'SELECT $tag$?$tag$, 2'
    )
  })
  it('带时间戳的线程交错按来源配对', () => {
    const rows = restoreMyBatisSql(
      '2026-10-25 09:00:00 DEBUG [a] Mapper ==> Preparing: SELECT ?\n2026-10-25 09:00:01 DEBUG [b] Mapper ==> Preparing: SELECT ?\n2026-10-25 09:00:02 DEBUG [a] Mapper ==> Parameters: 1(Integer)\n2026-10-25 09:00:03 DEBUG [b] Mapper ==> Parameters: 2(Integer)',
      'mysql'
    )
    expect(rows.map((row) => row.sql)).toEqual(['SELECT 1', 'SELECT 2'])
  })
  it('同源交错、缺失日志和参数数量不符不输出成功 SQL', () => {
    for (const input of [
      'Preparing: SELECT ?\nPreparing: SELECT ?\nParameters: 1(Integer)',
      'Preparing: SELECT ?',
      'Parameters: 1(Integer)',
      'Preparing: SELECT ?, ?\nParameters: 1(Integer)',
      'Preparing: SELECT ?\nParameters: 1(Integer), 2(Integer)'
    ]) {
      const rows = restoreMyBatisSql(input, 'mysql')
      expect(rows.every((row) => row.error && !row.sql)).toBe(true)
    }
  })
  it('支持无参数和布尔值，不猜测未知类型', () => {
    expect(restoreMyBatisSql('Preparing: SELECT 1\nParameters:', 'mysql')[0].sql).toBe('SELECT 1')
    expect(
      restoreMyBatisSql('Preparing: SELECT ?\nParameters: true(Boolean)', 'sqlite')[0].sql
    ).toBe('SELECT 1')
    expect(restoreMyBatisSql('Preparing: SELECT ?\nParameters: x(Blob)', 'mysql')[0].error).toMatch(
      '暂不支持'
    )
    expect(
      restoreMyBatisSql('Preparing: SELECT ?\nParameters: nope(Long)', 'mysql')[0].error
    ).toMatch('数字')
  })
  it('方言转义与不完整 SQL 校验', () => {
    expect(
      restoreMyBatisSql('Preparing: SELECT ?\nParameters: C:\\data(String)', 'mysql')[0].sql
    ).toBe("SELECT 'C:\\\\data'")
    expect(() => replaceSqlParameters("SELECT '?", [], 'sqlite')).toThrow('未闭合')
    expect(() => restoreMyBatisSql('x'.repeat(200001), 'mysql')).toThrow('20 万')
  })
})
