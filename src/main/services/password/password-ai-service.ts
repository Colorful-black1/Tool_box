import { readFileSync } from 'node:fs'
import type { AiCompletionOptions } from '../ai-gateway/ai-gateway'
import { join } from 'node:path'

import type { PasswordDraft } from '../../../shared/types'

const PROMPT_FILE = 'password_import.txt'
const MAX_INPUT_CHARS = 60_000
const TIMEOUT_MS = 90_000

interface AiRawEntry {
  name?: unknown
  title?: unknown
  username?: unknown
  account?: unknown
  user?: unknown
  password?: unknown
  pass?: unknown
  pwd?: unknown
  url?: unknown
  website?: unknown
  site?: unknown
  remark?: unknown
  note?: unknown
  description?: unknown
  updatedAt?: unknown
}

/**
 * 密码箱 AI 智能识别：复用全局 AI 配置走 OpenAI 兼容 chat/completions，
 * 提示词外置于 assets/prompts，解析容忍代码块围栏与前后说明文字。
 */
export class PasswordAiService {
  private promptCache: string | null = null

  constructor(
    private readonly assetsDir: string,
    private readonly chat: (system: string, user: string, options?: AiCompletionOptions) => Promise<string>
  ) {}

  private systemPrompt(): string {
    if (this.promptCache === null) {
      this.promptCache = readFileSync(join(this.assetsDir, PROMPT_FILE), 'utf8').trim()
    }
    return this.promptCache
  }

  async recognize(text: string, options: AiCompletionOptions = {}): Promise<{ entries: PasswordDraft[]; skipped: number }> {
    if (text.trim().length > MAX_INPUT_CHARS) {
      throw new Error(`内容过长（${text.length} 字符），请拆分后分批处理`)
    }

    const raw = await this.chat(this.systemPrompt(), text, options)
    const entries = parseAiResponse(raw)
    return { entries, skipped: 0 }
  }
}

/** 取第一个 '[' 到最后一个 ']' 之间的内容做 JSON.parse */
export function parseAiResponse(raw: string): PasswordDraft[] {
  const start = raw.indexOf('[')
  const end = raw.lastIndexOf(']')
  if (start < 0 || end <= start) {
    throw new Error('AI 返回内容不是有效的 JSON 数组')
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw.slice(start, end + 1))
  } catch (error) {
    throw new Error(`AI 返回的 JSON 解析失败：${(error as Error).message}`, { cause: error })
  }

  if (!Array.isArray(parsed)) {
    throw new Error('AI 返回内容不是数组')
  }

  const entries: PasswordDraft[] = []
  for (const item of parsed) {
    if (typeof item !== 'object' || item === null) continue
    const row = item as AiRawEntry

    const title = str(row.name) || str(row.title)
    const account = str(row.username) || str(row.account) || str(row.user)
    const password = str(row.password) || str(row.pass) || str(row.pwd)
    const url = str(row.url) || str(row.website) || str(row.site)
    const remark = str(row.remark) || str(row.note) || str(row.description)
    const updatedAtMs = parseDateMs(row.updatedAt)

    if (!title && !account) continue

    entries.push({ title, account, password, url, remark, updatedAtMs })
  }
  return entries
}

function str(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return ''
}

/** 支持 2024年1月15日 与 2024/01/15、2024.01.15、ISO 形式（统一按本地时区解析） */
export function parseDateMs(value: unknown): number | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined
  const text = value.trim()

  // 中文日期
  const cn = text.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日?/)
  if (cn) {
    return toLocalMs(Number(cn[1]), Number(cn[2]), Number(cn[3]))
  }

  // YYYY-MM-DD / YYYY/MM/DD / YYYY.MM.DD（避免 Date.parse 按 UTC 解析导致时区偏移）
  const iso = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/)
  if (iso) {
    return toLocalMs(Number(iso[1]), Number(iso[2]), Number(iso[3]))
  }

  // 其余交给内置解析
  const parsed = Date.parse(text)
  return Number.isNaN(parsed) ? undefined : parsed
}

function toLocalMs(year: number, month: number, day: number): number | undefined {
  const date = new Date(year, month - 1, day)
  if (Number.isNaN(date.getTime())) return undefined
  return date.getTime()
}

export { TIMEOUT_MS }
