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
