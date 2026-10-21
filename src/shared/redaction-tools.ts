import { checkToolInput, parseLosslessJson, renderJson } from './json-tools'
import type { JsonNode } from './json-tools'

export const REDACTION_LABELS = {
  credential: '凭据',
  email: '邮箱',
  phone: '手机号',
  identity: '身份证',
  bank: '银行卡候选'
} as const
export type RedactionKind = keyof typeof REDACTION_LABELS
export type RedactionRules = Record<RedactionKind, boolean>
export const DEFAULT_REDACTION_RULES: Readonly<RedactionRules> = {
  credential: true,
  email: true,
  phone: true,
  identity: true,
  bank: true
}

/** 仅返回结果与分类计数，原值到替身的映射不离开本次函数调用。 */
export interface RedactionResult {
  output: string
  counts: Record<RedactionKind, number>
  structured: boolean
}

const SECRET_KEYS = new Set([
  'password',
  'passwd',
  'pwd',
  'secret',
  'clientsecret',
  'apikey',
  'accesskey',
  'accesskeyid',
  'accesskeysecret',
  'authorization',
  'proxyauthorization',
  'token',
  'accesstoken',
  'refreshtoken',
  'idtoken',
  'cookie',
  'setcookie',
  'privatekey',
  'signingkey',
  'credential'
])
const isSecretKey = (key: string): boolean =>
  SECRET_KEYS.has(key.replace(/[-_\s.]/g, '').toLowerCase())

/** Luhn 仅用于识别候选，不证明数字属于真实银行卡。 */
function passesLuhn(text: string): boolean {
  let sum = 0
  for (let i = text.length - 1, alternate = false; i >= 0; i--, alternate = !alternate) {
    let digit = Number(text[i])
    if (alternate) {
      digit *= 2
      if (digit > 9) digit -= 9
    }
    sum += digit
  }
  return sum % 10 === 0 && !/^(\d)\1+$/.test(text)
}

export function redactData(
  text: string,
  rules: RedactionRules = DEFAULT_REDACTION_RULES,
  mode: 'auto' | 'text' | 'json' = 'auto'
): RedactionResult {
  checkToolInput(text)
  const structured =
    mode === 'json' || (mode === 'auto' && ['{', '['].includes(text.trimStart().charAt(0)))
  const root = structured ? parseLosslessJson(text) : null
  const counts: Record<RedactionKind, number> = {
    credential: 0,
    email: 0,
    phone: 0,
    identity: 0,
    bank: 0
  }
  const aliases = new Map<string, string>()
  const knownSecrets = new Set<string>()
  let nextAlias = 0
  const mask = (kind: RedactionKind, raw: string): string => {
    const key = kind + ':' + raw
    let alias = aliases.get(key)
    if (!alias) {
      if (aliases.size >= 1000) throw new Error('敏感内容种类过多，请分批脱敏')
      do {
        alias = `[${REDACTION_LABELS[kind]}_${++nextAlias}]`
      } while (text.includes(alias))
      aliases.set(key, alias)
    }
    counts[kind]++
    return alias
  }
  const collect = (node: JsonNode): void => {
    if (node.kind === 'array') node.items.forEach(collect)
    if (node.kind === 'object')
      for (const entry of node.entries) {
        if (rules.credential && isSecretKey(entry.key) && entry.value.kind !== 'null') {
          const raw = entry.value.kind === 'string' ? entry.value.value : renderJson(entry.value, 0)
          if (raw.length >= 6) knownSecrets.add(raw)
        }
        collect(entry.value)
      }
  }
  if (root) collect(root)
  if (knownSecrets.size > 200) throw new Error('凭据字段过多，请分批脱敏')
  const known = [...knownSecrets].sort((a, b) => b.length - a.length)
  const processText = (input: string): string => {
    let output = input
    if (rules.credential) {
      for (const secret of known) {
        const parts = output.split(secret)
        if (parts.length > 1) {
          const alias = mask('credential', secret)
          counts.credential += parts.length - 2
          output = parts.join(alias)
        }
      }
      output = output.replace(
        /^(\s*(?:authorization|proxy-authorization|cookie|set-cookie)\s*:\s*)([^\r\n]+)/gim,
        (_match, prefix: string, raw: string) => prefix + mask('credential', raw)
      )
      output = output.replace(
        /(\b(?:password|passwd|pwd|secret|client[-_]?secret|api[-_]?key|access[-_]?key(?:[-_]?secret)?|access[-_]?token|refresh[-_]?token|token)\b\s*[:=]\s*)("(?:\\.|[^"\\\r\n])*(?:"|$)|'(?:\\.|[^'\\\r\n])*(?:'|$)|[^\s,;}&]+)/gim,
        (_match, prefix: string, raw: string) => {
          const quote = raw[0] === '"' || raw[0] === "'" ? raw[0] : ''
          let value = quote ? raw.slice(1, raw.endsWith(quote) ? -1 : undefined) : raw
          if (quote === '"') {
            try {
              value = JSON.parse(raw) as string
            } catch {
              /* 日志中未闭合或非法转义的值仍整段替换，避免泄漏尾部内容。 */
            }
          } else if (quote === "'") value = value.replace(/\\(['\\])/g, '$1')
          const alias = mask('credential', value)
          return (
            prefix + (quote === '"' ? JSON.stringify(alias) : quote ? quote + alias + quote : alias)
          )
        }
      )
      output = output.replace(
        /\b(?:sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9_]{12,}|github_pat_[A-Za-z0-9_]{12,}|AKIA[A-Z0-9]{16})\b/g,
        (raw) => mask('credential', raw)
      )
      output = output.replace(/\b[A-Za-z0-9_-]{10,}(?:\.[A-Za-z0-9_-]{8,}){2,4}\b/g, (raw) =>
        mask('credential', raw)
      )
    }
    if (rules.email)
      output = output.replace(
        /[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,200}\.[A-Za-z]{2,24}/g,
        (raw) => mask('email', raw)
      )
    if (rules.identity)
      output = output.replace(
        /(^|[^\d])(\d{6}(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx])(?!\d)/g,
        (_match, prefix: string, raw: string) => prefix + mask('identity', raw)
      )
    if (rules.phone)
      output = output.replace(
        /(^|[^\d])((?:\+?86[ -]?)?1[3-9]\d{9})(?!\d)/g,
        (_match, prefix: string, raw: string) => prefix + mask('phone', raw)
      )
    if (rules.bank)
      output = output.replace(
        /(^|[^\d])(\d{15,19})(?!\d)/g,
        (_match, prefix: string, raw: string) =>
          prefix + (passesLuhn(raw) ? mask('bank', raw) : raw)
      )
    return output
  }
  const visit = (node: JsonNode): JsonNode => {
    if (node.kind === 'array') return { kind: 'array', items: node.items.map(visit) }
    if (node.kind === 'object')
      return {
        kind: 'object',
        entries: node.entries.map((entry) => ({
          key: entry.key,
          value:
            rules.credential && isSecretKey(entry.key) && entry.value.kind !== 'null'
              ? {
                  kind: 'string',
                  value: mask(
                    'credential',
                    entry.value.kind === 'string' ? entry.value.value : renderJson(entry.value, 0)
                  )
                }
              : visit(entry.value)
        }))
      }
    if (node.kind === 'string' || node.kind === 'number') {
      const masked = processText(node.value)
      return masked === node.value ? node : { kind: 'string', value: masked }
    }
    return node
  }
  return { output: root ? renderJson(visit(root)) : processText(text), counts, structured }
}
