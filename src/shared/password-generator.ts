/**
 * 密码生成与强度评估：两端共用的纯逻辑。
 *
 * 生成用**密码学安全的随机数**（`crypto.getRandomValues`）+ 拒绝采样，
 * 不用 `Math.random` —— 生成的密码是要真用来保护账号的。
 */

/** 生成选项 */
export interface PasswordOptions {
  /** 长度（8 ~ 64） */
  length: number
  useLower: boolean
  useUpper: boolean
  useDigits: boolean
  useSymbols: boolean
  /** 排除易混字符（0 O o、1 l I、|） */
  avoidAmbiguous: boolean
}

export const DEFAULT_PASSWORD_OPTIONS: PasswordOptions = {
  length: 16,
  useLower: true,
  useUpper: true,
  useDigits: true,
  useSymbols: true,
  avoidAmbiguous: true
}

const MIN_LENGTH = 8
const MAX_LENGTH = 64

/** 各类字符池 */
function buildPools(options: PasswordOptions): string[] {
  const ambiguous = new Set(['0', 'O', 'o', '1', 'l', 'I', '|'])
  const strip = (pool: string): string =>
    options.avoidAmbiguous ? [...pool].filter((char) => !ambiguous.has(char)).join('') : pool

  const pools: string[] = []
  if (options.useLower) pools.push(strip('abcdefghijklmnopqrstuvwxyz'))
  if (options.useUpper) pools.push(strip('ABCDEFGHIJKLMNOPQRSTUVWXYZ'))
  if (options.useDigits) pools.push(strip('0123456789'))
  if (options.useSymbols) pools.push(strip('!@#$%^&*()-_=+[]{};:,.<>?/~'))
  return pools.filter((pool) => pool.length > 0)
}

/** 密码学安全的 [0, max) 随机整数；用拒绝采样避免取模偏差 */
function randomIndex(max: number): number {
  const crypto = globalThis.crypto
  if (!crypto?.getRandomValues) {
    throw new Error('当前环境不支持安全随机数，无法生成密码')
  }
  const limit = Math.floor(0x100000000 / max) * max
  const buffer = new Uint32Array(1)
  let value: number
  do {
    crypto.getRandomValues(buffer)
    value = buffer[0]
  } while (value >= limit)
  return value % max
}

/**
 * 生成一个随机密码。
 *
 * 保证：每一类选中的字符至少出现一次，且字符位置是打乱的
 * （不然「小写字母永远在最前」会大幅削弱强度）。
 */
export function generatePassword(options: PasswordOptions = DEFAULT_PASSWORD_OPTIONS): string {
  const pools = buildPools(options)
  if (pools.length === 0) throw new Error('至少要选择一种字符类型')
  const length = Math.min(MAX_LENGTH, Math.max(MIN_LENGTH, Math.round(options.length)))
  if (length < pools.length) throw new Error('长度不能小于字符类型数量')

  const chars: string[] = []
  for (const pool of pools) chars.push(pool[randomIndex(pool.length)])
  const all = pools.join('')
  while (chars.length < length) chars.push(all[randomIndex(all.length)])

  // Fisher–Yates 洗牌
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = randomIndex(i + 1)
    const tmp = chars[i]
    chars[i] = chars[j]
    chars[j] = tmp
  }
  return chars.join('')
}

/** 强度评估结果 */
export interface PasswordStrength {
  /** 0 ~ 4 */
  score: number
  label: string
  /** 改进建议（为空表示没有明显问题） */
  hints: string[]
}

const SCORE_LABELS = ['很弱', '弱', '一般', '强', '很强']

/**
 * 粗略评估密码强度。
 *
 * 不是密码学强度评测，只看长度、字符种类与重复度 —— 够用来给用户提个醒。
 */
export function passwordStrength(password: string): PasswordStrength {
  const hints: string[] = []
  if (!password) return { score: 0, label: SCORE_LABELS[0], hints: ['还没有密码'] }

  let score = 0
  const length = [...password].length
  if (length >= 8) score += 1
  else hints.push('太短，建议至少 8 位')
  if (length >= 12) score += 1
  if (length >= 16) score += 1

  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((rule) =>
    rule.test(password)
  ).length
  if (classes >= 3) score += 1
  if (classes === 1) hints.push('只用了单一类型的字符')

  const unique = new Set([...password]).size
  if (length > 0 && unique / length < 0.6) hints.push('重复字符偏多')

  score = Math.min(4, score)
  return { score, label: SCORE_LABELS[score], hints }
}
