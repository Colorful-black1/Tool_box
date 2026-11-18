import { estimateTextTokens } from '../../../shared/context-tokens'
import {
  MEMORY_KIND_LABELS,
  MEMORY_KINDS,
  MEMORY_LIMITS,
  MEMORY_STATUSES
} from '../../../shared/types'
import type {
  MemoryExportFormat,
  MemoryImportResult,
  MemoryItemView,
  MemoryKind,
  MemoryListResult,
  MemoryQuery,
  MemorySaveInput,
  MemoryStateInput,
  MemoryStatus
} from '../../../shared/types'
import type { MemoryItemInput, ToolboxStore } from '../chat-store/chat-store'
import { parseMemoryExport, serializeMemoryExport } from './memory-transfer'

/** 常驻记忆的硬预算：与设计文档一致，避免挤占正常对话。 */
export const PINNED_MEMORY_BUDGET_TOKENS = 300
/** 单次请求相关记忆的硬预算；与常驻块分开计算。 */
export const RELEVANT_MEMORY_BUDGET_TOKENS = 800
/** 相关记忆最多注入条数。 */
export const RELEVANT_MEMORY_LIMIT = 5

const MEMORY_HEADER =
  '<system-reminder>\n以下是用户长期记忆，仅作参考。当前用户指令优先；不要编造未列出的记忆。'

/** 一条相关记忆注入时的正文上限，避免一条长文吃掉整个预算。 */
const RELEVANT_BODY_CHARS = 160

/** episodic 默认保留 90 天；到期自动归档，不物理删除。 */
const EPISODIC_TTL_MS = 90 * 24 * 60 * 60 * 1000

/** 自动候选的最大置信度：未审核内容不高于用户显式保存。 */
const CANDIDATE_MAX_CONFIDENCE = 0.8

/**
 * 明显的凭据形态：长期记忆不替代密码箱，命中即拒绝写入。
 * 只匹配可确认的密钥格式与“密码是 / API Key:”这类直白表述，避免误伤
 * “不要保存密码”之类的约束。
 */
const SENSITIVE_PATTERNS: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\b(?:sk|rk|pk)-[A-Za-z0-9_-]{20,}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bBearer\s+[A-Za-z0-9._-]{20,}\b/i,
  /(?:密码|口令)\s*(?:是|为|[:：=])\s*\S{4,}/,
  /\b(?:api[\s_-]*key|secret|token)\s*[:：=]\s*\S{8,}/i
]

/** 工具或设置页写入时可附带的来源；显式记忆默认 active。 */
export interface MemorySource {
  conversationId?: string
  messageId?: string
  excerpt?: string
}

/** 相关记忆检索：keyword 由 store 分词，tags 只做包含匹配。 */
export interface MemorySearchInput {
  query: string
  kind?: MemoryKind | 'all'
  tags?: string
  limit?: number
}

/** 自动提取候选：来源消息与置信度由提取器补齐，写入前统一归一化。 */
export interface MemoryCandidate {
  kind: MemoryKind
  title: string
  body: string
  tags: string[]
  confidence: number
  sourceMessageId?: string
  /** 用户原话摘录；缺省时用候选正文代替 */
  sourceExcerpt?: string
}

/** 通过校验后的显式记忆草稿；供审批预览复用，不落库。 */
export interface NormalizedMemoryDraft {
  kind: MemoryKind
  title: string
  body: string
  tags: string[]
  pinned: boolean
}

/**
 * 长期记忆服务：校验、显式写入与常驻注入。
 *
 * P0 只提供显式记忆与置顶注入；自动候选、检索评分与预算分配在后续阶段接入。
 * 仓储仍在 ToolboxStore，本服务不单独打开数据库连接。
 */
export class MemoryService {
  constructor(private readonly store: ToolboxStore) {}

  /** 总开关默认开启；关闭后不注入，也不向 Agent 暴露记忆工具。 */
  isEnabled(): boolean {
    return this.store.configGet()?.memoryEnabled !== false
  }

  /** 自动候选默认开启；关闭或总开关关闭时不触发提取。 */
  isAutoLearnEnabled(): boolean {
    return this.isEnabled() && this.store.configGet()?.memoryAutoLearn !== false
  }

  /** 到期事件在读取 / 注入前归档；返回本次归档条数，便于测试。 */
  archiveExpired(): number {
    return this.store.archiveExpiredMemories(Date.now())
  }

  list(query: MemoryQuery = {}): MemoryListResult {
    this.archiveExpired()
    return this.store.listMemoryItems({
      query: query.query ?? '',
      kind: query.kind ?? 'all',
      status: query.status ?? 'all',
      offset: query.offset ?? 0,
      limit: query.limit ?? 20
    })
  }

  get(id: string): MemoryItemView {
    const item = this.store.getMemoryItem(id)
    if (!item) throw new Error('记忆不存在，请刷新列表')
    return item
  }

  /**
   * 新建或编辑一条显式记忆。
   *
   * 新建即生效，置信度 0.9；编辑保留原有状态、置信度与来源，
   * 除非调用方（工具）提供了新的来源。这样设置页改文案不会把已归档记忆
   * 意外重新激活。
   */
  /** 校验并归一化草稿；审批卡在写入前就能显示最终内容。 */
  normalize(
    input: Pick<MemorySaveInput, 'kind' | 'title' | 'body' | 'tags'> & { pinned?: boolean }
  ): NormalizedMemoryDraft {
    const kind = requireKind(input.kind)
    const title = normalizeTitle(input.title)
    const body = normalizeBody(input.body)
    const tags = normalizeTags(input.tags)
    assertNoSecrets(`${title}\n${body}`)
    return { kind, title, body, tags, pinned: input.pinned === true }
  }

  save(input: MemorySaveInput, source: MemorySource = {}): MemoryItemView {
    const draft = this.normalize(input)

    if (input.id) {
      const existing = this.get(input.id)
      const next: MemoryItemInput = {
        ...draft,
        status: existing.status,
        confidence: existing.confidence,
        sourceConversationId: source.conversationId ?? existing.sourceConversationId,
        sourceMessageId: source.messageId ?? existing.sourceMessageId,
        sourceExcerpt: source.excerpt ?? existing.sourceExcerpt,
        expiresAtMs: existing.expiresAtMs
      }
      return this.store.updateMemoryItem(existing.id, next)
    }

    // 显式保存同主题内容：完全一致则复用，旧版本 / 待确认项归档，避免堆叠。
    const active = this.store.findMemoryByTitle(draft.kind, draft.title, 'active')
    if (active && sameContent(active.body, draft.body)) return active
    const pending = this.store.findMemoryByTitle(draft.kind, draft.title, 'pending')
    if (pending) this.store.setMemoryItemState(pending.id, { status: 'archived' })
    if (active) this.store.setMemoryItemState(active.id, { status: 'archived' })

    return this.store.insertMemoryItem({
      ...draft,
      status: 'active',
      confidence: 0.9,
      sourceConversationId: source.conversationId ?? null,
      sourceMessageId: source.messageId ?? null,
      sourceExcerpt: source.excerpt ?? null,
      expiresAtMs: defaultExpiry(draft.kind)
    })
  }

  /**
   * 自动候选写入：只创建 pending，绝不静默生效。
   *
   * - 同标题已拒绝：不再重复提议；
   * - 同标题已生效 / 待确认：跳过，避免候选箱被重复项刷屏；
   * - 同标题不同内容且已有生效项：保留 pending，批准时再归档旧版本。
   */
  saveCandidates(conversationId: string, candidates: MemoryCandidate[]): MemoryItemView[] {
    if (!this.isAutoLearnEnabled()) return []
    const saved: MemoryItemView[] = []
    for (const raw of candidates.slice(0, 3)) {
      let draft: NormalizedMemoryDraft
      try {
        draft = this.normalize({
          kind: raw.kind,
          title: raw.title,
          body: raw.body,
          tags: raw.tags,
          pinned: false
        })
      } catch {
        // 单条非法候选直接丢弃，不影响其它候选与正文回复。
        continue
      }

      if (this.store.findMemoryByTitle(draft.kind, draft.title, 'rejected')) continue
      if (this.store.findMemoryByTitle(draft.kind, draft.title, 'pending')) continue
      const active = this.store.findMemoryByTitle(draft.kind, draft.title, 'active')
      if (active && sameContent(active.body, draft.body)) continue

      const confidence = Math.min(CANDIDATE_MAX_CONFIDENCE, Math.max(0.3, raw.confidence))
      saved.push(
        this.store.insertMemoryItem({
          ...draft,
          status: 'pending',
          confidence,
          sourceConversationId: conversationId,
          sourceMessageId: raw.sourceMessageId ?? null,
          // 来源摘录可能包含用户原话里的密钥：命中敏感规则时退回已校验的正文。
          sourceExcerpt: (hasSensitiveContent(raw.sourceExcerpt ?? '')
            ? draft.body
            : (raw.sourceExcerpt ?? draft.body)
          ).slice(0, MEMORY_LIMITS.excerpt),
          expiresAtMs: defaultExpiry(draft.kind)
        })
      )
    }
    return saved
  }

  /** 状态变更：批准候选 / 恢复归档时归档同标题旧版本；其它状态只改本条。 */
  setState(input: MemoryStateInput): MemoryItemView {
    if (input.status !== undefined && !isStatus(input.status)) throw new Error('记忆状态无效')
    if (input.status === undefined && input.pinned === undefined)
      throw new Error('没有需要更新的记忆状态')
    if (input.pinned !== undefined && typeof input.pinned !== 'boolean')
      throw new Error('置顶状态无效')

    const existing = this.get(input.id)
    if (input.status === 'active' && existing.status !== 'active')
      this.store.archiveMemoryConflicts(existing.id, existing.kind, existing.title)
    return this.store.setMemoryItemState(input.id, {
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.pinned !== undefined ? { pinned: input.pinned } : {})
    })
  }

  remove(id: string): void {
    this.store.deleteMemoryItem(id)
  }

  /** 导出全部状态；JSON 可恢复，Markdown 只读。 */
  export(format: MemoryExportFormat): string {
    this.archiveExpired()
    const items = this.store.listMemoryItems({
      query: '',
      kind: 'all',
      status: 'all',
      offset: 0,
      limit: 5_000
    }).items
    return serializeMemoryExport(items, format)
  }

  /**
   * 导入 JSON：同类型 + 同标题合并，文件内重复只取第一条。
   * 非法条目跳过，不因一条坏数据拒绝整个文件；导入不写来源会话 id。
   */
  import(text: string): MemoryImportResult {
    const parsed = parseMemoryExport(text)
    const seen = new Set<string>()
    let imported = 0
    let updated = 0
    let skipped = 0

    for (const item of parsed) {
      const key = `${item.kind}\u0000${item.title}`
      if (seen.has(key)) {
        skipped += 1
        continue
      }
      seen.add(key)
      let draft: NormalizedMemoryDraft
      try {
        draft = this.normalize({
          kind: item.kind,
          title: item.title,
          body: item.body,
          tags: item.tags,
          pinned: item.pinned
        })
      } catch {
        skipped += 1
        continue
      }

      const expired = item.expiresAtMs !== null && item.expiresAtMs <= Date.now()
      const status = expired && item.status === 'active' ? 'archived' : item.status
      const payload: MemoryItemInput = {
        ...draft,
        status,
        confidence: item.confidence,
        sourceConversationId: null,
        sourceMessageId: null,
        sourceExcerpt: null,
        expiresAtMs: item.expiresAtMs
      }
      const existing = this.store.findMemoryByTitle(draft.kind, draft.title)
      if (existing) {
        if (status === 'active')
          this.store.archiveMemoryConflicts(existing.id, draft.kind, draft.title)
        this.store.updateMemoryItem(existing.id, payload)
        updated += 1
      } else {
        this.store.insertMemoryItem(payload)
        imported += 1
      }
    }

    return { total: parsed.length, imported, updated, skipped }
  }

  /**
   * 记忆注入块：常驻置顶项 + 与当前消息相关的 top-k。
   *
   * 不传用户消息时只注入常驻项（设置页 / 手动压缩 / 上下文浮层）。
   * 记忆按数据渲染，禁止其中内容覆盖系统提示或当前用户指令。
   */
  prompt(userText?: string): string {
    if (!this.isEnabled()) return ''
    this.archiveExpired()
    const pinned = this.pinnedLines()
    const relevant = userText?.trim() ? this.relevantLines(userText) : []
    if (pinned.length === 0 && relevant.length === 0) return ''

    const sections: string[] = []
    if (pinned.length > 0) sections.push('【常驻】', ...pinned)
    if (relevant.length > 0) sections.push('【相关】', ...relevant)
    return `${MEMORY_HEADER}\n${sections.join('\n')}\n</system-reminder>`
  }

  /** 兼容只读视图 / 手动压缩：只返回常驻块。 */
  pinnedPrompt(): string {
    return this.prompt()
  }

  /**
   * 检索记忆：FTS 优先，单字 / 无命中时回退子串匹配；返回按综合分排序的结果。
   * 供 `memory_search` 工具和相关注入共用。
   */
  search(input: MemorySearchInput): MemoryItemView[] {
    if (!this.isEnabled()) return []
    this.archiveExpired()
    const query = input.query.trim()
    if (!query) return []
    const limit = Math.min(20, Math.max(1, input.limit ?? RELEVANT_MEMORY_LIMIT))
    return this.rank(query, input.kind ?? 'all', input.tags, limit)
  }

  private pinnedLines(): string[] {
    const items = this.store.listPinnedMemoryItems(20)
    const lines: string[] = []
    for (const item of items) {
      const line = memoryLine(item)
      const candidate = [...lines, line, '</system-reminder>'].join('\n')
      if (estimateTextTokens(`${MEMORY_HEADER}\n${candidate}`) > PINNED_MEMORY_BUDGET_TOKENS) break
      lines.push(line)
    }
    return lines
  }

  private relevantLines(userText: string): string[] {
    const ranked = this.rank(userText, 'all', undefined, 20).filter((item) => !item.pinned)
    if (ranked.length === 0) return []
    const lines: string[] = []
    for (const item of ranked.slice(0, RELEVANT_MEMORY_LIMIT)) {
      const line = memoryLine(item)
      const candidate = [...lines, line, '</system-reminder>'].join('\n')
      const text = `${MEMORY_HEADER}\n【相关】\n${candidate}`
      if (estimateTextTokens(text) > RELEVANT_MEMORY_BUDGET_TOKENS) break
      lines.push(line)
    }
    return lines
  }

  /** 先按文本重排，再叠加置信度、时效与置顶/来源权重。 */
  private rank(
    query: string,
    kind: MemoryKind | 'all',
    tags: string | undefined,
    limit: number
  ): MemoryItemView[] {
    let items = this.store.searchMemoryItems({ query, kind, tags, limit: 20 })
    if (items.length === 0)
      items = this.store.searchMemoryItemsByText({ query, kind, tags, limit: 20 })
    if (items.length === 0) return []

    const now = Date.now()
    const scored = items.map((item, index) => {
      const relevance = 1 - index / Math.max(1, items.length)
      const ageDays = Math.max(0, (now - item.updatedAtMs) / 86_400_000)
      const recency = Math.max(0, 1 - ageDays / 180)
      const boost = item.pinned ? 1 : item.sourceConversationId ? 0.5 : 0
      return {
        item,
        score: 0.55 * relevance + 0.2 * item.confidence + 0.15 * recency + 0.1 * boost
      }
    })
    return scored
      .sort((left, right) => right.score - left.score)
      .slice(0, limit)
      .map((entry) => entry.item)
  }
}

function memoryLine(item: MemoryItemView): string {
  const body = oneLine(item.body)
  const short = body.length > RELEVANT_BODY_CHARS ? `${body.slice(0, RELEVANT_BODY_CHARS)}…` : body
  return `- [${MEMORY_KIND_LABELS[item.kind]}] ${oneLine(item.title)}${short ? `：${short}` : ''}`
}

function requireKind(value: unknown): MemoryKind {
  if (typeof value !== 'string' || !(MEMORY_KINDS as readonly string[]).includes(value))
    throw new Error('记忆类型无效')
  return value as MemoryKind
}

function isStatus(value: unknown): value is MemoryStatus {
  return typeof value === 'string' && (MEMORY_STATUSES as readonly string[]).includes(value)
}

function normalizeTitle(value: string): string {
  const title = String(value).replace(/\s+/g, ' ').trim()
  if (!title) throw new Error('记忆标题不能为空')
  if (title.length > MEMORY_LIMITS.title)
    throw new Error(`记忆标题不能超过 ${MEMORY_LIMITS.title} 字`)
  return title
}

function normalizeBody(value: string): string {
  const body = String(value).replace(/\r\n?/g, '\n').trim()
  if (!body) throw new Error('记忆正文不能为空')
  if (body.length > MEMORY_LIMITS.body) throw new Error(`记忆正文不能超过 ${MEMORY_LIMITS.body} 字`)
  return body
}

function normalizeTags(value: string[]): string[] {
  if (!Array.isArray(value)) throw new Error('记忆标签格式无效')
  if (value.length > MEMORY_LIMITS.tags) throw new Error(`记忆标签最多 ${MEMORY_LIMITS.tags} 个`)
  const tags: string[] = []
  for (const raw of value) {
    const tag = String(raw).replace(/\s+/g, ' ').trim()
    if (!tag) continue
    if (tag.length > MEMORY_LIMITS.tag) throw new Error(`单个标签不能超过 ${MEMORY_LIMITS.tag} 字`)
    if (!tags.includes(tag)) tags.push(tag)
  }
  return tags
}

function hasSensitiveContent(text: string): boolean {
  return SENSITIVE_PATTERNS.some((pattern) => pattern.test(text))
}

function assertNoSecrets(text: string): void {
  if (hasSensitiveContent(text)) throw new Error('记忆不能保存密码、API Key 或访问令牌')
}

function oneLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function defaultExpiry(kind: MemoryKind): number | null {
  return kind === 'episodic' ? Date.now() + EPISODIC_TTL_MS : null
}

function sameContent(left: string, right: string): boolean {
  return left.replace(/\s+/g, ' ').trim() === right.replace(/\s+/g, ' ').trim()
}
