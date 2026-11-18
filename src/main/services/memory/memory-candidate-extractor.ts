import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { MEMORY_KINDS } from '../../../shared/types'
import type { ChatMessage, MemoryKind } from '../../../shared/types'
import type { MemoryCandidate } from './memory-service'

const PROMPT_FILE = 'memory_extract.txt'

const FALLBACK_PROMPT =
  '只从对话中提取用户明确表达、可跨会话复用的偏好、事实、约束或流程。只输出 JSON 数组，最多 3 条；不要保存密码、密钥或一次性任务状态。'

/** 一次提取最多读取的消息数；只取最近内容，避免把整个会话再发一遍。 */
const MAX_CONTEXT_MESSAGES = 20
const MAX_MESSAGE_CHARS = 1200

/** 自动提取门槛：至少 4 个用户轮次，之后每 4 轮一次。 */
export function shouldExtractMemoryCandidates(userTurns: number): boolean {
  return userTurns >= 4 && userTurns % 4 === 0
}

export interface CandidateExtractionInput {
  messages: ChatMessage[]
  existingTitles: string[]
  signal?: AbortSignal
}

/** 模型调用由 Gateway 注入，提取器本身不依赖 LangChain。 */
export type CandidateCompletion = (
  system: string,
  user: string,
  options: { signal?: AbortSignal; maxOutputChars?: number }
) => Promise<string>

/**
 * 记忆候选提取器：拼提示词、调用一次无会话模型、解析并收窄 JSON。
 *
 * 解析失败或字段非法一律返回空数组，绝不猜测；调用方只负责把候选写入
 * pending，不在这里落库或激活。
 */
export class MemoryCandidateExtractor {
  private promptCache: string | null = null

  constructor(
    private readonly promptDir: string,
    private readonly complete: CandidateCompletion
  ) {}

  async extract(input: CandidateExtractionInput): Promise<MemoryCandidate[]> {
    const messages = input.messages.slice(-MAX_CONTEXT_MESSAGES).map((message) => ({
      ...message,
      content: message.content.slice(0, MAX_MESSAGE_CHARS)
    }))
    if (messages.length === 0) return []

    const text = await this.complete(
      this.systemPrompt(),
      buildUserPrompt(messages, input.existingTitles),
      {
        signal: input.signal,
        maxOutputChars: 4_000
      }
    )
    const userMessages = messages.filter((message) => message.role === 'user')
    const messageIds = new Set(userMessages.map((message) => message.id))
    const fallbackId = userMessages.at(-1)?.id
    return parseMemoryCandidates(text)
      .map((candidate) => {
        const sourceMessageId =
          candidate.sourceMessageId && messageIds.has(candidate.sourceMessageId)
            ? candidate.sourceMessageId
            : fallbackId
        const source = userMessages.find((message) => message.id === sourceMessageId)
        return {
          ...candidate,
          ...(sourceMessageId ? { sourceMessageId } : {}),
          ...(source ? { sourceExcerpt: source.content.slice(0, 500) } : {})
        }
      })
      .slice(0, 3)
  }

  private systemPrompt(): string {
    if (this.promptCache !== null) return this.promptCache
    try {
      this.promptCache = readFileSync(join(this.promptDir, PROMPT_FILE), 'utf8').trim()
    } catch {
      this.promptCache = FALLBACK_PROMPT
    }
    return this.promptCache
  }
}

/**
 * 解析模型返回的候选数组。
 *
 * 兼容整段 JSON、Markdown 代码块和 `{ candidates: [...] }`；其它形式直接丢弃。
 * 只做结构与长度收窄，敏感信息与业务校验仍由 MemoryService.normalize 负责。
 */
export function parseMemoryCandidates(text: string): MemoryCandidate[] {
  const raw = extractJsonArray(text)
  if (!raw) return []

  const candidates: MemoryCandidate[] = []
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue
    const record = entry as Record<string, unknown>
    if (
      typeof record.kind !== 'string' ||
      !(MEMORY_KINDS as readonly string[]).includes(record.kind)
    )
      continue
    if (typeof record.title !== 'string' || typeof record.body !== 'string') continue
    const title = record.title.trim()
    const body = record.body.trim()
    if (!title || !body) continue
    const tags = Array.isArray(record.tags)
      ? record.tags.filter((tag): tag is string => typeof tag === 'string').slice(0, 3)
      : []
    const confidence =
      typeof record.confidence === 'number' && Number.isFinite(record.confidence)
        ? Math.min(1, Math.max(0, record.confidence))
        : 0.5
    const sourceMessageId =
      typeof record.sourceMessageId === 'string' && record.sourceMessageId.length <= 64
        ? record.sourceMessageId
        : undefined
    candidates.push({
      kind: record.kind as MemoryKind,
      title,
      body,
      tags,
      confidence,
      ...(sourceMessageId ? { sourceMessageId } : {})
    })
    if (candidates.length >= 3) break
  }
  return candidates
}

function extractJsonArray(text: string): unknown[] | null {
  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  if (start < 0 || end <= start) return null
  try {
    const value: unknown = JSON.parse(text.slice(start, end + 1))
    if (!Array.isArray(value)) return null
    return value
  } catch {
    return null
  }
}

function buildUserPrompt(messages: ChatMessage[], existingTitles: string[]): string {
  const titles = existingTitles.length > 0 ? existingTitles.join('、') : '（无）'
  const lines = messages.map(
    (message) => `[${message.role} | ${message.id}] ${message.content.replace(/\s+/g, ' ').trim()}`
  )
  return `已有记忆标题：${titles}\n\n最近对话：\n${lines.join('\n')}`
}
