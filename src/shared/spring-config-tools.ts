/** 配置值保持文本，避免 Java long、大整数和占位符被 JS 数值转换破坏。 */
export type ConfigFormat = 'yaml' | 'properties'
export type FlatConfig = Map<string, string>
const MAX_CONFIG = 100000
const MAX_FIELDS = 2000

function checkInput(text: string): void {
  if (!text.trim() || text.length > MAX_CONFIG) throw new Error('配置应为 1 至 100000 字符')
}

function put(result: FlatConfig, key: string, value: string): void {
  if (!key || key.length > 512) throw new Error('配置键不能为空或超过 512 字符')
  if (result.has(key)) throw new Error('配置中存在重复键，需先处理后再转换')
  if (result.size >= MAX_FIELDS) throw new Error('最多处理 2000 个配置字段')
  result.set(key, value)
}

function unescapeProperty(text: string): string {
  return text.replace(/\\(u[\s\S]{0,4}|[\s\S])/g, (_match, escape: string) => {
    if (escape.startsWith('u')) {
      if (!/^u[\da-fA-F]{4}$/.test(escape)) throw new Error('Properties 的 Unicode 转义无效')
      return String.fromCharCode(parseInt(escape.slice(1), 16))
    }
    return ({ t: '\t', n: '\n', r: '\r', f: '\f' } as Record<string, string>)[escape] ?? escape
  })
}

/** Java Reader 语义：注释、转义分隔符、空白分隔及反斜杠续行。重复键明确拒绝。 */
function parseProperties(text: string): FlatConfig {
  const result: FlatConfig = new Map()
  const lines = text.replace(/^\uFEFF/, '').split(/\r\n|\n|\r/)
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].replace(/^[ \t\f]+/, '')
    if (!line || /^[#!]/.test(line)) continue
    while ((/\\+$/.exec(line)?.[0].length ?? 0) % 2 === 1) {
      line = line.slice(0, -1)
      if (++i >= lines.length) break
      line += lines[i].replace(/^[ \t\f]+/, '')
    }
    let end = 0
    for (; end < line.length; end++) {
      if (line[end] === '\\') {
        end++
        continue
      }
      if (/[=: \t\f]/.test(line[end])) break
    }
    let start = end
    while (/[ \t\f]/.test(line[start] ?? '') && start < line.length) start++
    if (line[start] === '=' || line[start] === ':') start++
    while (/[ \t\f]/.test(line[start] ?? '') && start < line.length) start++
    put(result, unescapeProperty(line.slice(0, end)), unescapeProperty(line.slice(start)))
  }
  return result
}

/** 仅识别引号之外的注释或映射分隔符；不会把 URL、# 密码或占位符截断。 */
function scanYaml(text: string, separator: boolean): number {
  let quote = ''
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quote === '"' && ch === '\\') {
      i++
      continue
    }
    if (quote === "'" && ch === "'" && text[i + 1] === "'") {
      i++
      continue
    }
    if (quote) {
      if (ch === quote) quote = ''
      continue
    }
    if (
      (ch === '"' || ch === "'") &&
      (/^\s*$/.test(text.slice(0, i)) || /[:-]\s*$/.test(text.slice(0, i)))
    ) {
      quote = ch
      continue
    }
    if (separator && ch === ':' && (i === text.length - 1 || /\s/.test(text[i + 1]))) return i
    if (!separator && ch === '#' && (i === 0 || /\s/.test(text[i - 1]))) return i
  }
  if (quote) throw new Error('YAML 引号未闭合；暂不支持跨行字符串')
  return -1
}

function scalar(text: string): string {
  if (text.startsWith('"')) {
    try {
      const parsed: unknown = JSON.parse(text)
      if (typeof parsed === 'string') return parsed
    } catch {
      /* 仅接受 JSON 兼容的双引号转义，其余返回统一语法提示。 */
    }
    throw new Error('YAML 双引号字符串需使用 JSON 兼容转义')
  }
  if (text.startsWith("'")) {
    if (!/^'(?:[^']|'')*'$/.test(text)) throw new Error('YAML 单引号字符串无效')
    return text.slice(1, -1).replace(/''/g, "'")
  }
  if (/^[&*!|>{[\]}`%@]/.test(text) || /:\s/.test(text) || /^[-?:](?:\s|$)/.test(text))
    throw new Error('暂不支持 YAML 锚点、标签、流式集合、多行标量或复杂键')
  if (/^(?:null|~)$/i.test(text))
    throw new Error('YAML null 无法无损转换为 Properties，请显式填写字符串')
  return text
}

/** 安全的 YAML 常用子集，拒绝不能保真的语法，不执行标签或解析别名。 */
function parseYaml(text: string): FlatConfig {
  const result: FlatConfig = new Map()
  const lines: { indent: number; body: string }[] = []
  for (const raw of text.replace(/^\uFEFF/, '').split(/\r\n|\n|\r/)) {
    if (/^\s*\t/.test(raw)) throw new Error('YAML 缩进请使用空格')
    const comment = scanYaml(raw, false)
    const line = (comment < 0 ? raw : raw.slice(0, comment)).trimEnd()
    if (!line.trim()) continue
    const body = line.trimStart(),
      indent = line.length - body.length
    if (/^(?:---|\.\.\.)(?:\s|$)/.test(body) || body.startsWith('%'))
      throw new Error('请一次处理一个 YAML 文档，移除文档分隔符与指令')
    // 把列表内的首个映射字段展开为同层块，便于统一检查后续缩进。
    if (body.startsWith('- ') && scanYaml(body.slice(2), true) >= 0) {
      lines.push({ indent, body: '-' }, { indent: indent + 2, body: body.slice(2) })
    } else lines.push({ indent, body })
  }
  let index = 0
  function block(indent: number, path: string, depth: number): void {
    if (depth > 24) throw new Error('配置嵌套不能超过 24 层')
    const list = /^-(?: |$)/.test(lines[index].body)
    const keys = new Set<string>()
    let itemIndex = 0
    while (index < lines.length && lines[index].indent >= indent) {
      const line = lines[index]
      if (line.indent !== indent) throw new Error('YAML 缩进层次不一致')
      if (/^-(?: |$)/.test(line.body) !== list) throw new Error('同一层不能混用列表和映射')
      const separator = list ? -1 : scanYaml(line.body, true)
      if (!list && separator < 0) throw new Error('YAML 映射需要键、冒号及空格')
      const key = list ? `[${itemIndex++}]` : scalar(line.body.slice(0, separator).trim())
      if (keys.has(key)) throw new Error('YAML 中存在重复键')
      keys.add(key)
      if (!list && (!key || /[[\]\r\n]/.test(key)))
        throw new Error('配置键不支持空值、换行或方括号')
      const full = list ? `${path}${key}` : path ? `${path}.${key}` : key
      const value = list ? line.body.slice(1).trim() : line.body.slice(separator + 1).trim()
      index++
      if (value) {
        put(result, full, scalar(value))
        if (index < lines.length && lines[index].indent > indent)
          throw new Error('标量后不能再嵌套配置')
      } else if (index < lines.length && lines[index].indent > indent) {
        block(lines[index].indent, full, depth + 1)
      } else throw new Error('空节点不能无损转换，请使用显式空字符串')
    }
  }
  if (lines.length) {
    if (lines[0].indent !== 0 || /^-(?: |$)/.test(lines[0].body))
      throw new Error('顶层配置应为无缩进的映射')
    block(0, '', 0)
  }
  return result
}

export function parseSpringConfig(text: string, format: ConfigFormat): FlatConfig {
  checkInput(text)
  if (format !== 'yaml' && format !== 'properties') throw new Error('配置格式无效')
  return format === 'yaml' ? parseYaml(text) : parseProperties(text)
}

function escapeProperty(text: string, key: boolean): string {
  return text.replace(/[\\\n\r\t\f =:#!]/g, (ch, index: number) => {
    const escaped = (
      { '\n': '\\n', '\r': '\\r', '\t': '\\t', '\f': '\\f' } as Record<string, string>
    )[ch]
    return escaped ?? (ch === '\\' || key || (ch === ' ' && index === 0) ? `\\${ch}` : ch)
  })
}

/** 用 Map 建树，避免 __proto__ 等外部键触碰对象原型；路径冲突直接拒绝。 */
interface ConfigNode {
  value?: string
  children: Map<string, ConfigNode>
}
function toYaml(config: FlatConfig): string {
  const root: ConfigNode = { children: new Map() }
  for (const [key, value] of config) {
    const segments = key.match(/[^.[\]]+|\[\d+\]/g) ?? []
    if (segments[0]?.startsWith('[')) throw new Error('顶层配置应为映射，不能直接使用列表下标')
    if (
      segments.length > 24 ||
      segments.map((s, i) => (s.startsWith('[') || i === 0 ? s : `.${s}`)).join('') !== key
    )
      throw new Error('配置路径无效或过深；仅支持点分层级和数字列表下标')
    let node = root
    for (const segment of segments) {
      if (node.value !== undefined) throw new Error('配置键存在父子路径冲突')
      let child = node.children.get(segment)
      if (!child) {
        child = { children: new Map() }
        node.children.set(segment, child)
      }
      node = child
    }
    if (node.children.size || node.value !== undefined) throw new Error('配置键存在父子路径冲突')
    node.value = value
  }
  function emit(node: ConfigNode, depth: number): string[] {
    const entries = [...node.children.entries()]
    const list = entries[0]?.[0].startsWith('[')
    if (entries.some(([key]) => key.startsWith('[') !== list))
      throw new Error('配置路径不能同时作为列表和映射')
    if (list) {
      entries.sort((a, b) => Number(a[0].slice(1, -1)) - Number(b[0].slice(1, -1)))
      if (entries.some(([key], i) => key !== `[${i}]`)) throw new Error('列表下标必须从 0 连续递增')
    }
    return entries.flatMap(([key, child]) => {
      const prefix = `${'  '.repeat(depth)}${list ? '-' : `${JSON.stringify(key)}:`}`
      return child.value !== undefined
        ? [`${prefix} ${JSON.stringify(child.value)}`]
        : [prefix, ...emit(child, depth + 1)]
    })
  }
  return emit(root, 0).join('\n')
}

export function convertSpringConfig(text: string, format: ConfigFormat): string {
  const parsed = parseSpringConfig(text, format)
  // 两个方向均检查结构冲突；不输出貌似有效但无法还原的配置。
  const yaml = toYaml(parsed)
  return format === 'properties'
    ? yaml
    : [...parsed]
        .map(([key, value]) => `${escapeProperty(key, true)}=${escapeProperty(value, false)}`)
        .join('\n')
}

/** 只报告键和值差异，不推断 profile 激活、环境覆盖或占位符解析。 */
export function compareSpringConfig(left: FlatConfig, right: FlatConfig): string {
  return (
    [...new Set([...left.keys(), ...right.keys()])]
      .sort()
      .flatMap((key) => {
        if (!left.has(key)) return [`仅右侧  ${key} = ${JSON.stringify(right.get(key))}`]
        if (!right.has(key)) return [`仅左侧  ${key} = ${JSON.stringify(left.get(key))}`]
        return left.get(key) === right.get(key)
          ? []
          : [
              `值不同  ${key}\n  左：${JSON.stringify(left.get(key))}\n  右：${JSON.stringify(right.get(key))}`
            ]
      })
      .join('\n') || '配置字段和值一致'
  )
}
