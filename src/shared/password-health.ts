import type { PasswordEntryView } from './types'
import { passwordStrength } from './password-generator'

export const PASSWORD_STALE_DAYS = 365
export const PASSWORD_DUPLICATE_MIN_COUNT = 2
export const PASSWORD_WEAK_MAX_SCORE = 1
const DAY_MS = 86_400_000

/** 健康报告仅携带定位信息，不将密码或账号复制到报告视图。 */
export interface PasswordHealthItem {
  id: string
  title: string
  strength: string
  days: number
}

/** 明文仅作为本次计算的临时分组键，返回值不含明文。 */
export function analyzePasswordHealth(
  entries: PasswordEntryView[],
  now = Date.now()
): {
  total: number
  failed: number
  duplicates: PasswordHealthItem[][]
  weak: PasswordHealthItem[]
  stale: PasswordHealthItem[]
  empty: PasswordHealthItem[]
} {
  const groups = new Map<string, PasswordHealthItem[]>()
  const weak: PasswordHealthItem[] = []
  const stale: PasswordHealthItem[] = []
  const empty: PasswordHealthItem[] = []
  let failed = 0
  for (const entry of entries) {
    if (!entry.isDecryptable) {
      failed += 1
      continue
    }
    const strength = passwordStrength(entry.password)
    const age = Math.max(0, now - entry.updatedAtMs)
    const item = {
      id: entry.id,
      title: entry.title,
      strength: strength.label,
      days: Number.isFinite(age) ? Math.floor(age / DAY_MS) : 0
    }
    if (age > PASSWORD_STALE_DAYS * DAY_MS) stale.push(item)
    if (entry.password === '') {
      empty.push(item)
    }
    // 指标分别统计：空密码也可同时命中重复、弱或长期未改，不做互斥分类。
    if (strength.score <= PASSWORD_WEAK_MAX_SCORE) weak.push(item)
    const group = groups.get(entry.password) ?? []
    group.push(item)
    groups.set(entry.password, group)
  }
  return {
    total: entries.length,
    failed,
    duplicates: [...groups.values()].filter(
      (group) => group.length >= PASSWORD_DUPLICATE_MIN_COUNT
    ),
    weak,
    stale,
    empty
  }
}
