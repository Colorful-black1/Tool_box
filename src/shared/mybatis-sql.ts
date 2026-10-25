import { checkToolInput } from './json-tools'

export const SQL_DIALECTS = ['mysql', 'postgresql', 'sqlite'] as const
export type SqlDialect = (typeof SQL_DIALECTS)[number]

/** 单条还原结果；失败条目不会混入可复制的 SQL。 */
export interface RestoredSql {
  line: number
  sql: string
  error?: string
}

function sqlValue(value: string, type: string, dialect: SqlDialect): string {
  const simpleType = type.split('.').pop() ?? type
  if (/^(Byte|Short|Integer|Long|BigInteger|Float|Double|BigDecimal)$/.test(simpleType)) {
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value))
      throw new Error('数字参数格式无效')
    return value
  }
  if (simpleType === 'Boolean') {
    if (!/^(true|false)$/i.test(value)) throw new Error('布尔参数格式无效')
    return dialect === 'sqlite' ? (value.toLowerCase() === 'true' ? '1' : '0') : value.toUpperCase()
  }
  if (
    !/^(String|Character|Date|Time|Timestamp|LocalDate|LocalTime|LocalDateTime|OffsetDateTime)$/.test(
      simpleType
    )
  )
    throw new Error(`暂不支持参数类型 ${simpleType.slice(0, 60)}`)
  if (value.includes('\0')) throw new Error('参数包含不支持的空字符')
  const escaped = value.replace(/'/g, "''")
  // MySQL 默认反斜杠转义；其他方言使用标准单引号转义。
  return `'${dialect === 'mysql' ? escaped.replace(/\\/g, '\\\\') : escaped}'`
}

function parameters(text: string, dialect: SqlDialect): string[] {
  if (!text.trim()) return []
  if (/,\s*$/.test(text)) throw new Error('参数列表不完整，末尾不能只有分隔符')
  const values: string[] = []
  let cursor = 0
  const ending = /\(([\w.$]+(?:\[\])?)\)(?:,\s*|$)/g
  while (cursor < text.length) {
    const nullMatch = /^null(?:,\s*|$)/.exec(text.slice(cursor))
    if (nullMatch) {
      values.push('NULL')
      cursor += nullMatch[0].length
    } else {
      ending.lastIndex = cursor
      const match = ending.exec(text)
      if (!match) throw new Error('参数缺少类型或日志被截断')
      values.push(sqlValue(text.slice(cursor, match.index), match[1], dialect))
      cursor = ending.lastIndex
    }
    if (values.length > 2000) throw new Error('单条 SQL 最多支持 2000 个参数')
  }
  return values
}

/** 逐字扫描，仅替换字符串、标识符和注释以外的占位符。 */
export function replaceSqlParameters(sql: string, values: string[], dialect: SqlDialect): string {
  let output = ''
  let index = 0
  let parameterIndex = 0
  while (index < sql.length) {
    const char = sql[index]
    const pair = sql.slice(index, index + 2)
    if (pair === '--' || (char === '#' && dialect === 'mysql')) {
      const end = sql.indexOf('\n', index)
      const next = end < 0 ? sql.length : end
      output += sql.slice(index, next)
      index = next
    } else if (pair === '/*') {
      const end = sql.indexOf('*/', index + 2)
      if (end < 0) throw new Error('SQL 注释未闭合')
      output += sql.slice(index, end + 2)
      index = end + 2
    } else if (
      dialect === 'postgresql' &&
      char === '$' &&
      /^\$(?:[A-Za-z_]\w*)?\$/.test(sql.slice(index))
    ) {
      const tag = /^\$(?:[A-Za-z_]\w*)?\$/.exec(sql.slice(index))![0]
      const end = sql.indexOf(tag, index + tag.length)
      if (end < 0) throw new Error('SQL 美元引号未闭合')
      output += sql.slice(index, end + tag.length)
      index = end + tag.length
    } else if (char === "'" || char === '"' || char === '`' || char === '[') {
      const close = char === '[' ? ']' : char
      const start = index++
      let closed = false
      while (index < sql.length) {
        if (sql[index] === '\\' && dialect === 'mysql') index += 2
        else if (sql[index] === close) {
          if (sql[index + 1] === close) index += 2
          else {
            index++
            closed = true
            break
          }
        } else index++
      }
      if (!closed) throw new Error('SQL 引号未闭合')
      output += sql.slice(start, index)
    } else {
      if (char === '?') {
        if (parameterIndex >= values.length) throw new Error('占位符数量多于参数，无法可靠还原')
        output += values[parameterIndex++]
      } else output += char
      index++
    }
  }
  if (parameterIndex !== values.length) throw new Error('参数数量多于占位符，无法可靠还原')
  return output
}

/** 保留线程和 logger，去掉每行变化的时间戳与日志级别。 */
function sourceKey(prefix: string): string {
  return prefix
    .replace(/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?(?:Z|[+-]\d{2}:?\d{2})?/g, '')
    .replace(/\b\d{2}:\d{2}:\d{2}(?:[.,]\d+)?\b/g, '')
    .replace(/\b(?:TRACE|DEBUG|INFO|WARN|ERROR)\b/g, '')
    .replace(/[=><]+\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function restoreMyBatisSql(text: string, dialect: SqlDialect): RestoredSql[] {
  checkToolInput(text)
  const result: RestoredSql[] = []
  const pending = new Map<string, { sql: string; line: number; ambiguous: boolean }>()
  for (const [offset, line] of text.split(/\r?\n/).entries()) {
    const match = /\b(Preparing|Parameters):\s?(.*)$/.exec(line)
    if (!match) continue
    const key = sourceKey(line.slice(0, match.index))
    const previous = pending.get(key)
    if (match[1] === 'Preparing') {
      if (previous)
        result.push({
          line: previous.line,
          sql: '',
          error: '同一来源出现多条未配对 SQL，无法确定参数归属'
        })
      pending.set(key, { sql: match[2].trim(), line: offset + 1, ambiguous: !!previous })
    } else if (!previous) {
      result.push({ line: offset + 1, sql: '', error: '参数行缺少对应的 Preparing 日志' })
    } else {
      pending.delete(key)
      try {
        if (previous.ambiguous) throw new Error('同一来源的 SQL 配对有歧义，请单独粘贴一组日志')
        if (!previous.sql) throw new Error('Preparing 内容为空')
        result.push({
          line: previous.line,
          sql: replaceSqlParameters(previous.sql, parameters(match[2], dialect), dialect)
        })
      } catch (error) {
        result.push({
          line: previous.line,
          sql: '',
          error: error instanceof Error ? error.message : '还原失败'
        })
      }
    }
    if (result.length + pending.size > 200) throw new Error('一次最多还原 200 条 SQL')
  }
  for (const item of pending.values())
    result.push({ line: item.line, sql: '', error: '缺少 Parameters 日志，无法确认参数' })
  return result.sort((a, b) => a.line - b.line)
}
