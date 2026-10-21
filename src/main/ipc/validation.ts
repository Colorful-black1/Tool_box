import { APP_THEMES } from '../../shared/appearance'

export function requireString(
  value: unknown,
  name: string,
  options: { allowEmpty?: boolean; maxLength?: number } = {}
): string {
  if (typeof value !== 'string') {
    throw new Error(`${name}必须是字符串`)
  }
  const trimmed = value.trim()
  if (!options.allowEmpty && !trimmed) {
    throw new Error(`${name}不能为空`)
  }
  if (options.maxLength && trimmed.length > options.maxLength) {
    throw new Error(`${name}长度不能超过 ${options.maxLength} 字符`)
  }
  return trimmed
}

export function requireNonNegativeInt(value: unknown, name: string): number {
  const num = typeof value === 'string' ? Number(value) : value
  if (typeof num !== 'number' || !Number.isInteger(num) || num < 0) {
    throw new Error(`${name}无效`)
  }
  return num
}

export function requireRatio(value: unknown, name: string): number {
  const num = typeof value === 'string' ? Number(value) : value
  if (typeof num !== 'number' || Number.isNaN(num)) {
    throw new Error(`${name}无效`)
  }
  return Math.min(1, Math.max(0, num))
}

export function requireStringArray(value: unknown, name: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${name}必须是数组`)
  return value.map((item, index) => requireString(item, `${name}[${index}]`))
}

/**
 * 可选字符串数组：未传或 null 返回 undefined，其余逐项校验并限量。
 *
 * 用于「可选清单」类入参（例如勾选的模型列表）：
 * 不传 = 不改动，[] = 清空，两种语义要区分开，所以不能用 requireStringArray。
 */
export function optionalStringArray(
  value: unknown,
  name: string,
  options: { maxItems?: number; maxLength?: number } = {}
): string[] | undefined {
  if (value === undefined || value === null) return undefined
  if (!Array.isArray(value)) throw new Error(`${name}必须是数组`)
  if (options.maxItems && value.length > options.maxItems) {
    throw new Error(`${name}最多 ${options.maxItems} 项`)
  }
  return value.map((item, index) =>
    requireString(item, `${name}[${index}]`, { maxLength: options.maxLength })
  )
}

/** 枚举 / 白名单校验：动态排序、供应商 id 等外部可控的固定选项必须走这里 */
export function requireEnum<T extends string>(
  value: unknown,
  name: string,
  allowed: readonly T[]
): T {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    throw new Error(`${name}无效`)
  }
  return value as T
}

/** 可选字符串：未传或空串返回 undefined，其余走 requireString 校验 */
export function optionalString(
  value: unknown,
  name: string,
  options: { maxLength?: number } = {}
): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  return requireString(value, name, { maxLength: options.maxLength })
}

export function assertObject(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${name}无效`)
  }
  return value as Record<string, unknown>
}

/** 只校验本次新增的外观字段，保留既有阅读配置和快捷键的合并语义。 */
export function validateConfigPatch(value: unknown): Record<string, unknown> {
  const patch = assertObject(value, '配置')
  if (!Object.hasOwn(patch, 'appearance')) return patch
  const appearance = assertObject(patch.appearance, '外观配置')
  const theme = requireEnum(appearance.theme, '应用主题', APP_THEMES)
  if (typeof appearance.backgroundMotion !== 'boolean') {
    throw new Error('背景动效设置无效')
  }
  return { ...patch, appearance: { theme, backgroundMotion: appearance.backgroundMotion } }
}
