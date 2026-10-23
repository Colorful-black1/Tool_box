/** JWT 只解码不验签，时间声明的检查不能替代认证。 */
export interface JwtPreview {
  header: Record<string, unknown>
  payload: Record<string, unknown>
  claims: { name: string; value: string }[]
  warnings: string[]
}

function decodePart(part: string): Record<string, unknown> {
  if (!part || !/^[A-Za-z0-9_-]+$/.test(part) || part.length % 4 === 1)
    throw new Error('JWT 编码无效')
  let parsed: unknown
  try {
    const binary = atob(part.replace(/-/g, '+').replace(/_/g, '/'))
    parsed = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(
        Uint8Array.from(binary, (ch) => ch.charCodeAt(0))
      )
    )
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid')
  } catch {
    throw new Error('JWT 头或载荷不是有效的 UTF-8 JSON 对象')
  }
  // JSON.parse 接受极深对象；在 React 格式化前先以有界的迭代遍历阻断栈溢出。
  const pending: { value: unknown; depth: number }[] = [{ value: parsed, depth: 0 }]
  let count = 0
  while (pending.length) {
    const item = pending.pop()!
    if (item.depth > 32 || ++count > 10000) throw new Error('JWT JSON 最多 32 层、10000 个节点')
    if (item.value && typeof item.value === 'object')
      for (const child of Object.values(item.value))
        pending.push({ value: child, depth: item.depth + 1 })
  }
  return parsed as Record<string, unknown>
}

export function inspectJwt(source: string, now = Date.now()): JwtPreview {
  if (!source.trim() || source.length > 32768) throw new Error('JWT 应为 1 至 32768 字符')
  const parts = source
    .trim()
    .replace(/^Bearer\s+/i, '')
    .split('.')
  if (parts.length === 5) throw new Error('这是 JWE 加密令牌，本工具仅支持三段 JWT')
  if (parts.length !== 3 || !/^[A-Za-z0-9_-]*$/.test(parts[2]) || parts[2].length % 4 === 1)
    throw new Error('JWT 应由三段 Base64URL 内容组成')
  const header = decodePart(parts[0]),
    payload = decodePart(parts[1])
  const warnings = ['签名未验证，不能据此判断令牌真实有效']
  if (typeof header.alg !== 'string' || !header.alg) warnings.push('缺少签名算法声明')
  if (header.alg === 'none' || !parts[2]) warnings.push('令牌未签名或签名为空')
  const claims = ['iat', 'nbf', 'exp'].flatMap((name) => {
    if (!Object.hasOwn(payload, name)) return []
    const value = payload[name]
    if (
      typeof value !== 'number' ||
      !Number.isFinite(value) ||
      !Number.isFinite(new Date(value * 1000).getTime())
    ) {
      warnings.push(`${name} 不是有效的 NumericDate 秒数`)
      return [{ name, value: '时间声明无效' }]
    }
    if (name === 'exp' && value * 1000 <= now) warnings.push('令牌已过期（exp）')
    if (name === 'nbf' && value * 1000 > now) warnings.push('令牌尚未生效（nbf）')
    if (name === 'iat' && value * 1000 > now) warnings.push('签发时间晚于当前时间（iat）')
    return [{ name, value: new Date(value * 1000).toISOString() }]
  })
  return { header, payload, claims, warnings }
}
