import { useMemo, useState } from 'react'
import type { JSX } from 'react'
import { restoreMyBatisSql } from '@shared/mybatis-sql'
import type { SqlDialect } from '@shared/mybatis-sql'
import { Dropdown } from '../../dropdown'
import { Workbench } from '../workbench'
import { ToolOutputActions } from '../output-actions'

/** MyBatis 日志仅还原文本，失败条目从输出中排除。 */
export function MyBatisPanel(): JSX.Element {
  const [input, setInput] = useState('')
  const [dialect, setDialect] = useState<SqlDialect>('mysql')
  const result = useMemo(() => {
    try {
      const rows = restoreMyBatisSql(input, dialect)
      return {
        rows,
        output: rows
          .filter((row) => !row.error)
          .map((row) => `-- 来源第 ${row.line} 行\n${row.sql}`)
          .join('\n\n')
      }
    } catch (error) {
      return { rows: [], output: '', error: error instanceof Error ? error.message : '还原失败' }
    }
  }, [input, dialect])
  return (
    <div className="tool-stack">
      <div className="tool-controls">
        <Dropdown
          ariaLabel="SQL 方言"
          value={dialect}
          options={[
            { value: 'mysql', label: 'MySQL（默认转义）' },
            { value: 'postgresql', label: 'PostgreSQL（标准字符串）' },
            { value: 'sqlite', label: 'SQLite' }
          ]}
          onChange={(value) => setDialect(value as SqlDialect)}
        />
        <span className="field-hint">
          本机处理，不执行 SQL；日志截断、特殊类型和数据库转义设置可能影响结果。
        </span>
      </div>
      <Workbench
        inputLabel="MyBatis 日志"
        outputLabel="还原 SQL"
        value={input}
        onChange={setInput}
        output={result.output}
        error={result.error}
        placeholder={
          '==> Preparing: SELECT * FROM users WHERE id = ? AND name = ?\n==> Parameters: 1(Long), 小明(String)'
        }
      />
      {input.trim() && !result.rows.length && !result.error ? (
        <p className="field-hint">未找到标准 Preparing / Parameters 日志，请粘贴完整的一组。</p>
      ) : null}
      {result.rows
        .filter((row) => row.error)
        .map((row) => (
          <p className="status-banner" role="alert" key={row.line}>
            第 {row.line} 行：{row.error}
          </p>
        ))}
      <ToolOutputActions text={result.output} title="MyBatis SQL" />
    </div>
  )
}
