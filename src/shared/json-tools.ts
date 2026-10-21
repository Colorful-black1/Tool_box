/** 本机工具的输入上限，避免超大粘贴内容阻塞渲染线程。 */
export const MAX_TOOL_INPUT = 200_000
const MAX_DEPTH = 64
const MAX_NODES = 40_000

/** 数字保留原始词法文本，避免 Long、小数与指数经浮点转换损失信息。 */
export type JsonNode =
  | { kind: 'object'; entries: Array<{ key: string; value: JsonNode }> }
  | { kind: 'array'; items: JsonNode[] }
  | { kind: 'string'; value: string }
  | { kind: 'number'; value: string }
  | { kind: 'boolean'; value: boolean }
  | { kind: 'null' }

export function checkToolInput(text: string): void {
  if (text.length > MAX_TOOL_INPUT) throw new Error('输入过长，最多支持 20 万字符')
}

/** 只解析 JSON，不执行表达式；对象用条目数组表示，特殊键不会修改原型。 */
export function parseLosslessJson(text: string): JsonNode {
  checkToolInput(text)
  let position = 0
  let nodes = 0
  const fail = (message: string): never => {
    const prefix = text.slice(0, position)
    const line = prefix.split('\n').length
    const column = position - prefix.lastIndexOf('\n')
    throw new Error(`${message}（第 ${line} 行，第 ${column} 列）`)
  }
  const skip = (): void => {
    while (/[\x20\t\r\n]/.test(text[position] ?? '') && position < text.length) position++
  }
  const string = (): string => {
    const start = position++
    while (position < text.length) {
      const char = text[position++]
      if (char === '"') {
        // 仅让原生解析器解码已隔离的字符串，不把任何数字交给它。
        try {
          return JSON.parse(text.slice(start, position)) as string
        } catch {
          return fail('字符串转义无效')
        }
      }
      if (char.charCodeAt(0) < 32) return fail('字符串包含未转义的控制字符')
      if (char === '\\') position++
    }
    return fail('字符串缺少结束引号')
  }
  const value = (depth: number): JsonNode => {
    skip()
    if (++nodes > MAX_NODES) return fail('JSON 节点过多，请缩小输入')
    if (depth > MAX_DEPTH) return fail('JSON 嵌套过深，最多支持 64 层')
    const char = text[position]
    if (char === '"') return { kind: 'string', value: string() }
    if (char === '{') {
      position++
      skip()
      const entries: Array<{ key: string; value: JsonNode }> = []
      const keys = new Set<string>()
      if (text[position] === '}') {
        position++
        return { kind: 'object', entries }
      }
      while (position < text.length) {
        skip()
        if (text[position] !== '"') return fail('对象字段名必须使用双引号')
        const key = string()
        if (keys.has(key)) return fail('对象存在重复字段，请先处理重复键')
        keys.add(key)
        skip()
        if (text[position++] !== ':') return fail('字段名后缺少冒号')
        entries.push({ key, value: value(depth + 1) })
        skip()
        const separator = text[position++]
        if (separator === '}') return { kind: 'object', entries }
        if (separator !== ',') return fail('对象字段之间缺少逗号或结束括号')
      }
      return fail('对象缺少结束括号')
    }
    if (char === '[') {
      position++
      skip()
      const items: JsonNode[] = []
      if (text[position] === ']') {
        position++
        return { kind: 'array', items }
      }
      while (position < text.length) {
        items.push(value(depth + 1))
        skip()
        const separator = text[position++]
        if (separator === ']') return { kind: 'array', items }
        if (separator !== ',') return fail('数组元素之间缺少逗号或结束括号')
      }
      return fail('数组缺少结束括号')
    }
    for (const literal of ['true', 'false', 'null']) {
      if (text.startsWith(literal, position)) {
        position += literal.length
        return literal === 'null'
          ? { kind: 'null' }
          : { kind: 'boolean', value: literal === 'true' }
      }
    }
    const number = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(text.slice(position))
    if (number) {
      position += number[0].length
      return { kind: 'number', value: number[0] }
    }
    return fail('JSON 值无效')
  }
  if (!text.trim()) throw new Error('请输入 JSON 文本')
  const root = value(0)
  skip()
  if (position !== text.length) return fail('JSON 末尾存在多余内容')
  return root
}

export function renderJson(node: JsonNode, indent = 2, sortKeys = false, depth = 0): string {
  if (node.kind === 'string') return JSON.stringify(node.value)
  if (node.kind === 'number') return node.value
  if (node.kind === 'boolean') return String(node.value)
  if (node.kind === 'null') return 'null'
  const entries =
    node.kind === 'object'
      ? sortKeys
        ? [...node.entries].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
        : node.entries
      : []
  const children =
    node.kind === 'object'
      ? entries.map(
          (entry) =>
            `${JSON.stringify(entry.key)}:${indent ? ' ' : ''}${renderJson(entry.value, indent, sortKeys, depth + 1)}`
        )
      : node.items.map((item) => renderJson(item, indent, sortKeys, depth + 1))
  const [open, close] = node.kind === 'object' ? ['{', '}'] : ['[', ']']
  if (!children.length) return open + close
  if (!indent) return open + children.join(',') + close
  return `${open}\n${children.map((child) => ' '.repeat((depth + 1) * indent) + child).join(',\n')}\n${' '.repeat(depth * indent)}${close}`
}

export function formatLosslessJson(text: string, indent = 2, sortKeys = false): string {
  return renderJson(parseLosslessJson(text), indent, sortKeys)
}

/** 常用 JSONPath 子集：不执行过滤器、脚本、递归查询或用户提供的代码。 */
export function extractJsonPath(text: string, path: string): string {
  if (path.length > 512 || !path.startsWith('$'))
    throw new Error('路径必须以 $ 开头，最多 512 字符')
  const segments: Array<string | number | null> = []
  let offset = 1
  while (offset < path.length) {
    const rest = path.slice(offset)
    const dot = /^\.([\p{L}_$][\p{L}\p{N}_$]*)/u.exec(rest)
    const index = /^\[(0|[1-9]\d*)\]/.exec(rest)
    const quoted = /^\[((?:"(?:[^"\\]|\\.)*")|(?:'[^'\\]*'))\]/.exec(rest)
    if (dot) {
      segments.push(dot[1])
      offset += dot[0].length
    } else if (index) {
      segments.push(Number(index[1]))
      offset += index[0].length
    } else if (rest.startsWith('[*]')) {
      segments.push(null)
      offset += 3
    } else if (quoted) {
      const token = quoted[1]
      try {
        segments.push(token.startsWith('"') ? (JSON.parse(token) as string) : token.slice(1, -1))
      } catch {
        throw new Error('路径字符串转义无效')
      }
      offset += quoted[0].length
    } else throw new Error('不支持此路径语法；可使用点属性、引号属性、数组下标和 [*]')
    if (segments.length > MAX_DEPTH) throw new Error('路径层级过多')
  }
  let matches = [parseLosslessJson(text)]
  for (const segment of segments) {
    const next: JsonNode[] = []
    for (const node of matches) {
      if (segment === null) {
        next.push(
          ...(node.kind === 'array'
            ? node.items
            : node.kind === 'object'
              ? node.entries.map((entry) => entry.value)
              : [])
        )
      } else if (typeof segment === 'number' && node.kind === 'array') {
        if (node.items[segment]) next.push(node.items[segment])
      } else if (typeof segment === 'string' && node.kind === 'object') {
        const entry = node.entries.find((item) => item.key === segment)
        if (entry) next.push(entry.value)
      }
      if (next.length > 4000) throw new Error('路径命中超过 4000 项，请缩小范围')
    }
    matches = next
  }
  return renderJson(
    matches.length === 1 && !segments.includes(null)
      ? matches[0]
      : { kind: 'array', items: matches }
  )
}

/** 解开顶层 JSON 字符串，或将对象中包裹的 JSON 对象/数组字符串展开一次。 */
export function expandJsonStrings(text: string): string {
  const root = parseLosslessJson(text)
  if (root.kind === 'string') return root.value
  const expand = (node: JsonNode): JsonNode => {
    if (node.kind === 'object')
      return {
        kind: 'object',
        entries: node.entries.map((entry) => ({ key: entry.key, value: expand(entry.value) }))
      }
    if (node.kind === 'array') return { kind: 'array', items: node.items.map(expand) }
    if (node.kind === 'string' && ['{', '['].includes(node.value.trimStart().charAt(0))) {
      try {
        return parseLosslessJson(node.value)
      } catch {
        /* 内容只是普通字符串或非完整 JSON 时保留原值。 */
      }
    }
    return node
  }
  return renderJson(expand(root))
}
