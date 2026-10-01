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

export function assertObject(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${name}无效`)
  }
  return value as Record<string, unknown>
}