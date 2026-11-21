/** 来源页面只读取文本；所有字段在进入快照前都经过长度与数值收窄。 */

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' '
}

export function decodeHtml(value: string): string {
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, entity: string) => {
    if (entity.startsWith('#x') || entity.startsWith('#X')) {
      const code = Number.parseInt(entity.slice(2), 16)
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole
    }
    if (entity.startsWith('#')) {
      const code = Number.parseInt(entity.slice(1), 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole
    }
    return ENTITIES[entity.toLowerCase()] ?? whole
  })
}

export function text(value: unknown, max = 200): string {
  if (typeof value !== 'string') return ''
  return decodeHtml(value).replace(/\s+/g, ' ').trim().slice(0, max)
}

export function number(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string' || !value.trim()) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

/** 来源的 0–1 比例统一成页面使用的百分数。 */
export function percent(value: number | null): number | null {
  return value == null ? null : value * 100
}

export function htmlAttribute(block: string, name: string): string | null {
  const match = new RegExp(`\\b${name}="([^"]*)"`, 'i').exec(block)
  return match ? decodeHtml(match[1]) : null
}

/** 从固定标记后的第一个 JSON 数组开始，按括号深度截取。 */
export function extractJsonArray(source: string, marker: string): string | null {
  const start = source.indexOf(marker)
  if (start < 0) return null
  const begin = source.indexOf('[', start)
  if (begin < 0) return null
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = begin; i < source.length; i++) {
    const char = source[i]
    if (inString) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') inString = true
    else if (char === '[') depth++
    else if (char === ']') {
      depth--
      if (depth === 0) return source.slice(begin, i + 1)
    }
  }
  return null
}

export function mean(values: readonly (number | null)[]): number | null {
  const finite = values.filter((value): value is number => value != null && Number.isFinite(value))
  return finite.length ? finite.reduce((sum, value) => sum + value, 0) / finite.length : null
}

export function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0)
}

export function uniqueBy<T>(items: readonly T[], key: (item: T) => string): T[] {
  const seen = new Set<string>()
  return items.filter((item) => {
    const value = key(item)
    if (seen.has(value)) return false
    seen.add(value)
    return true
  })
}
