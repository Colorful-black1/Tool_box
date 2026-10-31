import type { JsonNode } from './json-tools'
import { parseLosslessJson } from './json-tools'

/** 派生接口上限：超过后改用 Record，避免一次粘贴生成上百个类型。 */
const MAX_INTERFACES = 80
const ROOT_NAME = 'Root'
const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/

interface InterfaceBlock {
  name: string
  body: string
}

type ObjectNode = Extract<JsonNode, { kind: 'object' }>

/** 结构签名用于「同形状只生成一个接口」，与字段值无关。 */
function signature(node: JsonNode): string {
  if (node.kind === 'object') {
    return `{${node.entries.map((entry) => `${entry.key}:${signature(entry.value)}`).join(',')}}`
  }
  if (node.kind === 'array') {
    const parts = [...new Set(node.items.map(signature))].sort()
    return `[${parts.join('|')}]`
  }
  return node.kind
}

function pascal(value: string): string {
  const words = value.split(/[^A-Za-z0-9]+/).filter(Boolean)
  const joined = words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join('')
  if (!joined) return 'Item'
  return /^[0-9]/.test(joined) ? `T${joined}` : joined
}

function propertyName(key: string): string {
  return IDENTIFIER.test(key) ? key : JSON.stringify(key)
}

/** 合并同字段的多个可能类型；空数组带来的 unknown[] 不应冲淡已知的 `string[]`。 */
function unionOf(types: string[]): string {
  const unique = [...new Set(types)]
  const parts = unique.length > 1 ? unique.filter((type) => type !== 'unknown[]') : unique
  return parts.length === 1 ? parts[0] : `(${parts.join(' | ')})`
}

class TypeGenerator {
  private readonly blocks = new Map<string, InterfaceBlock>()
  private readonly order: InterfaceBlock[] = []
  private readonly usedNames = new Set<string>()

  private uniqueName(base: string): string {
    if (!this.usedNames.has(base)) {
      this.usedNames.add(base)
      return base
    }
    let index = 2
    while (this.usedNames.has(`${base}${index}`)) index++
    const name = `${base}${index}`
    this.usedNames.add(name)
    return name
  }

  private objectType(node: ObjectNode, hint: string): string {
    if (!node.entries.length) return 'Record<string, unknown>'
    const key = signature(node)
    const existing = this.blocks.get(key)
    if (existing) return existing.name
    if (this.order.length >= MAX_INTERFACES) return 'Record<string, unknown>'
    const block: InterfaceBlock = { name: this.uniqueName(pascal(hint)), body: '' }
    this.blocks.set(key, block)
    this.order.push(block)
    block.body = node.entries
      .map((entry) => `  ${propertyName(entry.key)}: ${this.typeOf(entry.value, entry.key)}`)
      .join('\n')
    return block.name
  }

  /**
   * 数组里同键不同字段的对象合并成一个接口：缺字段标记为可选，
   * 避免真实接口少返回一个字段就多出一个 `Xxx2` 类型。
   */
  private mergedObjectType(nodes: ObjectNode[], hint: string): string {
    const keys: string[] = []
    const values = new Map<string, JsonNode[]>()
    for (const node of nodes) {
      for (const entry of node.entries) {
        const list = values.get(entry.key)
        if (list) list.push(entry.value)
        else {
          values.set(entry.key, [entry.value])
          keys.push(entry.key)
        }
      }
    }
    const mergedKey = `merged:${keys
      .map((key) => {
        const list = values.get(key) ?? []
        const shapes = [...new Set(list.map(signature))].sort().join('|')
        return `${key}${list.length === nodes.length ? '' : '?'}:${shapes}`
      })
      .join(',')}`
    const existing = this.blocks.get(mergedKey)
    if (existing) return existing.name
    if (this.order.length >= MAX_INTERFACES) return 'Record<string, unknown>'
    const block: InterfaceBlock = { name: this.uniqueName(pascal(hint)), body: '' }
    this.blocks.set(mergedKey, block)
    this.order.push(block)
    block.body = keys
      .map((key) => {
        const list = values.get(key) ?? []
        const types: string[] = []
        for (const item of list) {
          const type = this.typeOf(item, key)
          if (!types.includes(type)) types.push(type)
        }
        const type = unionOf(types)
        const optional = list.length < nodes.length ? '?' : ''
        return `  ${propertyName(key)}${optional}: ${type}`
      })
      .join('\n')
    return block.name
  }

  typeOf(node: JsonNode, hint: string): string {
    if (node.kind === 'string') return 'string'
    if (node.kind === 'number') return 'number'
    if (node.kind === 'boolean') return 'boolean'
    if (node.kind === 'null') return 'null'
    if (node.kind === 'object') return this.objectType(node, hint)
    if (!node.items.length) return 'unknown[]'
    const objects = node.items.filter(
      (item): item is ObjectNode => item.kind === 'object' && item.entries.length > 0
    )
    const parts: string[] = []
    if (objects.length) {
      const shapes = new Set(objects.map(signature))
      parts.push(
        shapes.size > 1 ? this.mergedObjectType(objects, hint) : this.objectType(objects[0], hint)
      )
    }
    for (const item of node.items) {
      if (item.kind === 'object' && item.entries.length) continue
      const type = this.typeOf(item, hint)
      if (!parts.includes(type)) parts.push(type)
    }
    return `${unionOf(parts)}[]`
  }

  render(): string {
    return this.order
      .map((block) => `export interface ${block.name} {\n${block.body}\n}`)
      .join('\n\n')
  }
}

/**
 * 把一段 JSON 转成 TypeScript 类型：对象变成 interface，同形状复用同一个接口；
 * 数组里字段不一致的对象合并成一个接口并把缺失字段标为可选，其余元素类型取并集；
 * 字段名不是合法标识符时加引号。
 * 数字统一输出 number（大整数在类型层面同样无法精确表示）。
 */
export function generateTypeScriptTypes(text: string): string {
  const root = parseLosslessJson(text)
  const generator = new TypeGenerator()
  if (root.kind === 'object') {
    generator.typeOf(root, ROOT_NAME)
    return generator.render()
  }
  const type = generator.typeOf(root, 'RootItem')
  const interfaces = generator.render()
  const declaration = `export type ${ROOT_NAME} = ${type}`
  return interfaces ? `${declaration}\n\n${interfaces}` : declaration
}
