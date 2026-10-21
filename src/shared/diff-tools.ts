import { checkToolInput, parseLosslessJson, renderJson } from './json-tools'
import type { JsonNode } from './json-tools'

/** 文本差异保留两侧行号；大输入回退为公共前后缀与替换块。 */
export interface TextDiffLine {
  kind: 'same' | 'added' | 'removed'
  text: string
  beforeLine?: number
  afterLine?: number
}

export function compareText(
  before: string,
  after: string,
  ignoreWhitespace = false
): {
  lines: TextDiffLine[]
  coarse: boolean
} {
  checkToolInput(before)
  checkToolInput(after)
  const left = before === '' ? [] : before.split(/\r?\n/)
  const right = after === '' ? [] : after.split(/\r?\n/)
  const normalize = (line: string): string => (ignoreWhitespace ? line.replace(/\s+/g, '') : line)
  const a = left.map(normalize)
  const b = right.map(normalize)
  const lines: TextDiffLine[] = []
  const add = (kind: TextDiffLine['kind'], i: number, j: number): void => {
    lines.push({
      kind,
      text: kind === 'added' ? right[j] : left[i],
      beforeLine: kind === 'added' ? undefined : i + 1,
      afterLine: kind === 'removed' ? undefined : j + 1
    })
  }
  if ((a.length + 1) * (b.length + 1) > 1_000_000) {
    let start = 0
    while (start < a.length && start < b.length && a[start] === b[start]) {
      add('same', start, start)
      start++
    }
    let endA = a.length
    let endB = b.length
    while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
      endA--
      endB--
    }
    for (let i = start; i < endA; i++) add('removed', i, start)
    for (let j = start; j < endB; j++) add('added', start, j)
    while (endA < a.length) add('same', endA++, endB++)
    return { lines, coarse: true }
  }
  // 限制矩阵大小后使用 LCS；每个单元最多 1000，Uint32 避免行数边界溢出。
  const width = b.length + 1
  const matrix = new Uint32Array((a.length + 1) * width)
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      matrix[i * width + j] =
        a[i] === b[j]
          ? matrix[(i + 1) * width + j + 1] + 1
          : Math.max(matrix[(i + 1) * width + j], matrix[i * width + j + 1])
    }
  }
  let i = 0
  let j = 0
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      add('same', i++, j++)
    } else if (
      i < a.length &&
      (j === b.length || matrix[(i + 1) * width + j] >= matrix[i * width + j + 1])
    )
      add('removed', i++, j)
    else add('added', i, j++)
  }
  return { lines, coarse: false }
}

/** JSON 差异仅保存有限的字段预览，原始输入始终由调用方保留。 */
export interface JsonDifference {
  kind: 'added' | 'removed' | 'changed'
  path: string
  before: string
  after: string
}

export function compareJson(
  before: string,
  after: string,
  ignoredKeys: string[] = []
): {
  changes: JsonDifference[]
  truncated: boolean
} {
  const left = parseLosslessJson(before)
  const right = parseLosslessJson(after)
  const ignored = new Set(ignoredKeys)
  const changes: JsonDifference[] = []
  let truncated = false
  const preview = (node: JsonNode | undefined): string => {
    if (!node) return ''
    const text = renderJson(node, 0)
    return text.length > 1000 ? text.slice(0, 1000) + '…（预览截断）' : text
  }
  const visit = (a: JsonNode | undefined, b: JsonNode | undefined, path: string): void => {
    if (changes.length >= 300) {
      truncated = true
      return
    }
    if (a?.kind === 'object' && b?.kind === 'object') {
      const leftEntries = new Map(a.entries.map((entry) => [entry.key, entry.value]))
      const rightEntries = new Map(b.entries.map((entry) => [entry.key, entry.value]))
      for (const key of new Set([...leftEntries.keys(), ...rightEntries.keys()])) {
        if (!ignored.has(key))
          visit(leftEntries.get(key), rightEntries.get(key), `${path}[${JSON.stringify(key)}]`)
      }
    } else if (a?.kind === 'array' && b?.kind === 'array') {
      for (let i = 0; i < Math.max(a.items.length, b.items.length); i++)
        visit(a.items[i], b.items[i], `${path}[${i}]`)
    } else if (!a || !b || renderJson(a, 0) !== renderJson(b, 0)) {
      changes.push({
        path: path.length > 1024 ? path.slice(0, 1024) + '…（路径截断）' : path,
        kind: !a ? 'added' : !b ? 'removed' : 'changed',
        before: preview(a),
        after: preview(b)
      })
    }
  }
  visit(left, right, '$')
  return { changes, truncated }
}
