/**
 * 本地知识库的共享契约（渲染层与主进程共用）。
 *
 * 这里只有纯类型、常量与无副作用的计算：分块见 `kb-chunking.ts`，
 * 分词见 `kb-tokenize.ts`。数据表结构见 `chat-store.ts` 的 schema v6。
 */

/** 预设类别；新增类别只改常量与界面文案，不动库结构。 */
export const KB_CATEGORIES = [
  { id: 'work', label: '工作资料' },
  { id: 'personal', label: '个人资料' }
] as const

export type KbCategoryId = (typeof KB_CATEGORIES)[number]['id']

/** 类别 id 作为筛选条件与库内取值，只允许小写字母、数字与连字符。 */
export const KB_CATEGORY_PATTERN = /^[a-z0-9][a-z0-9-]{0,19}$/

export function isKbCategoryId(value: unknown): value is KbCategoryId {
  return typeof value === 'string' && KB_CATEGORIES.some((item) => item.id === value)
}

export function kbCategoryLabel(id: string): string {
  return KB_CATEGORIES.find((item) => item.id === id)?.label ?? id
}

export const KB_DOCUMENT_STATUSES = ['pending', 'indexing', 'ready', 'failed'] as const

export type KbDocumentStatus = (typeof KB_DOCUMENT_STATUSES)[number]

export const KB_STATUS_LABELS: Record<KbDocumentStatus, string> = {
  pending: '待索引',
  indexing: '索引中',
  ready: '就绪',
  failed: '失败'
}

export function isKbDocumentStatus(value: unknown): value is KbDocumentStatus {
  return typeof value === 'string' && (KB_DOCUMENT_STATUSES as readonly string[]).includes(value)
}

/** hybrid 为默认；未配置向量模型时主进程降级为纯关键词并标记 degraded。 */
export const KB_SEARCH_MODES = ['hybrid', 'keyword', 'semantic'] as const

export type KbSearchMode = (typeof KB_SEARCH_MODES)[number]

/**
 * 降级原因：
 * - no-embedding     当前档案没有填写向量模型
 * - no-vectors       配了向量模型，但资料还没有向量（可在资料库点「补齐向量」）
 * - embedding-failed 向量接口调用失败，本次只返回关键词结果
 * - too-many-vectors 向量块超过内存扫描上限，暂不启用语义检索
 */
export const KB_DEGRADED_REASONS = [
  'no-embedding',
  'no-vectors',
  'embedding-failed',
  'too-many-vectors'
] as const

export type KbDegradedReason = (typeof KB_DEGRADED_REASONS)[number]

/** 重排结果状态：未配置 / 已生效 / 调用失败后保持融合排序。 */
export const KB_RERANK_STATES = ['off', 'applied', 'failed'] as const

export type KbRerankState = (typeof KB_RERANK_STATES)[number]

/** 支持导入的扩展名（大小写不敏感）。 */
export const KB_SUPPORTED_EXTENSIONS = ['.md', '.txt'] as const

export const KB_MAX_FILE_BYTES = 10 * 1024 * 1024
export const KB_MAX_DOCUMENTS = 200
export const KB_MAX_CHUNKS = 50_000
export const KB_MAX_IMPORT_FILES = 50
export const KB_MAX_QUERY_CHARS = 200

/** 检索结果预算：与对话上下文匹配，避免一次把整库塞给模型。 */
export const KB_SEARCH_MAX_CHUNKS = 8
export const KB_SEARCH_MAX_CHARS = 6000
export const KB_SEARCH_PER_DOCUMENT = 4
/** 单段命中最多返回的字符数，超出按句号截断。 */
export const KB_HIT_MAX_CHARS = 1200

/** 向量化：批量大小、并发与内存扫描上限。 */
export const KB_EMBEDDING_BATCH = 32
export const KB_EMBEDDING_CONCURRENCY = 2
/** 超过这个块数不在主进程做暴力余弦，避免几百 MB 向量常驻内存。 */
export const KB_EMBEDDING_SCAN_LIMIT = 20_000
export const KB_SEMANTIC_CANDIDATES = 20
/** 余弦阈值：低于它视为不相关，避免“什么都能召回一点”。 */
export const KB_COSINE_MIN = 0.25
export const KB_RRF_K = 60
/** 重排最多送多少段、每段最多多少字，控制请求体大小。 */
export const KB_RERANK_TOP = 20
export const KB_RERANK_DOC_CHARS = 2000

/** 列表只回摘要，不含正文与绝对路径。 */
export interface KbDocumentView {
  id: string
  title: string
  category: string
  fileName: string
  fileSize: number
  status: KbDocumentStatus
  chunkCount: number
  /** 已写入向量的块数；与 chunkCount 的差值就是待补齐数量。 */
  embeddedChunkCount: number
  error: string
  createdAtMs: number
  updatedAtMs: number
}

/** 详情里的分块预览：不整篇回传，避免十几 MB 正文跨 IPC。 */
export interface KbChunkPreview {
  id: string
  ordinal: number
  heading: string
  charCount: number
  startOffset: number
  preview: string
}

export interface KbDocumentDetail {
  document: KbDocumentView
  sourcePath: string
  chunks: KbChunkPreview[]
  /** 引用跳转时要定位的块；不属于该文档时为 null。 */
  focusChunkId: string | null
}

export interface KbListInput {
  category?: string
  status?: KbDocumentStatus
  query?: string
}

export interface KbImportInput {
  /** 不传时由主进程弹系统文件选择框；AI 审批导入必须显式传路径。 */
  paths?: string[]
  category?: string
}

export interface KbImportSkip {
  path: string
  reason: string
}

export interface KbImportResult {
  imported: KbDocumentView[]
  skipped: KbImportSkip[]
}

export interface KbSearchInput {
  query: string
  category?: string
  /** 默认 hybrid；P1 没有向量模型，hybrid / semantic 会降级为关键词。 */
  mode?: KbSearchMode
  /** 期望条数，默认与预算一致（8），上限 20。 */
  topK?: number
}

export interface KbSearchHit {
  chunkId: string
  documentId: string
  documentTitle: string
  category: string
  heading: string
  ordinal: number
  charCount: number
  content: string
  startOffset: number
  /** BM25 原始分数（越小越相关），供检索自测与调参。 */
  score: number
}

export interface KbSearchResult {
  query: string
  mode: 'keyword' | 'hybrid'
  hits: KbSearchHit[]
  /** 有值时说明实际使用了降级路径，界面与 Agent 都要如实说明。 */
  degraded: KbDegradedReason | null
  /** 降级 / 重排失败的可读原因（已脱敏）。 */
  message: string
  rerank: KbRerankState
  /** 融合前两路各召回多少条，供检索自测与排查。 */
  keywordCount: number
  semanticCount: number
  totalChars: number
  /** 因预算或单文档限额未返回的命中数。 */
  dropped: number
}

/** 索引进度：按文档推送，done / total 为文件计数。 */
export interface KbProgressEvent {
  documentId: string
  title: string
  phase: 'reading' | 'chunking' | 'indexing' | 'embedding' | 'ready' | 'failed'
  done: number
  total: number
  message?: string
  /** embedding 阶段的分批进度；其他阶段为空。 */
  embedding?: { done: number; total: number }
}

export const KB_PROGRESS_LABELS: Record<KbProgressEvent['phase'], string> = {
  reading: '读取文件',
  chunking: '切分正文',
  indexing: '写入索引',
  embedding: '生成向量',
  ready: '已完成',
  failed: '失败'
}

export interface KbHitBudget {
  maxChunks?: number
  maxChars?: number
  perDocument?: number
  clipChars?: number
}

/**
 * 按预算挑选命中：保持 BM25 顺序，限制单文档占比，并截断过长片段。
 *
 * 纯函数，主进程与单测共用；一律从第一条开始尝试，凑不满就少给，
 * 不为了凑数把后面的低分块塞进上下文。
 */
export function selectKbHits(
  hits: readonly KbSearchHit[],
  budget: KbHitBudget = {}
): { hits: KbSearchHit[]; totalChars: number; dropped: number } {
  const maxChunks = budget.maxChunks ?? KB_SEARCH_MAX_CHUNKS
  const maxChars = budget.maxChars ?? KB_SEARCH_MAX_CHARS
  const perDocument = budget.perDocument ?? KB_SEARCH_PER_DOCUMENT
  const clipChars = budget.clipChars ?? KB_HIT_MAX_CHARS

  const selected: KbSearchHit[] = []
  const perDocumentCount = new Map<string, number>()
  let totalChars = 0

  for (const hit of hits) {
    if (selected.length >= maxChunks) break
    const used = perDocumentCount.get(hit.documentId) ?? 0
    if (used >= perDocument) continue
    const content = clipSegment(hit.content, clipChars)
    if (selected.length > 0 && totalChars + content.length > maxChars) break
    selected.push({ ...hit, content })
    perDocumentCount.set(hit.documentId, used + 1)
    totalChars += content.length
  }

  return { hits: selected, totalChars, dropped: hits.length - selected.length }
}

/**
 * 截断片段：优先落在句末标点或换行，找不到才硬切。
 * 至少保留 60% 的内容，避免为了"完整句子"只剩一句话。
 */
export function clipSegment(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  const head = text.slice(0, maxChars)
  let cut = 0
  for (let index = head.length - 1; index >= Math.floor(maxChars * 0.6); index -= 1) {
    if (/[。！？；.!?;\n]/.test(head[index])) {
      cut = index + 1
      break
    }
  }
  const body = cut > 0 ? head.slice(0, cut) : head
  return `${body.trimEnd()}…`
}

/** 检索结果给 Agent 的可读文本（带编号与出处，不含内部 id）。 */
export function formatKbHitsForAgent(result: KbSearchResult): string | null {
  if (result.hits.length === 0) return null
  const lines = result.hits.map((hit, index) => {
    const source = hit.heading ? `${hit.documentTitle} › ${hit.heading}` : hit.documentTitle
    return `[${index + 1}] ${source}（第 ${hit.ordinal + 1} 段）\n${hit.content}`
  })
  const notices: string[] = []
  if (result.degraded) {
    notices.push(result.message || '本次仅使用关键词检索，回答时请如实说明。')
  } else if (result.mode === 'hybrid') {
    notices.push('以上为知识库中与问题最接近的片段（关键词 + 语义融合）。')
  } else {
    notices.push('以上为知识库中与问题最接近的关键词命中。')
  }
  if (result.rerank === 'failed') notices.push('重排模型调用失败，已保持融合排序。')
  const omitted =
    result.dropped > 0 ? `\n还有 ${result.dropped} 段命中因上下文预算未展开。` : ''
  return `${notices.join(' ')}\n\n${lines.join('\n\n')}${omitted}`
}

/** 空结果时给 Agent 的建议，避免它反复重试同一句查询。 */
export const KB_EMPTY_HINT =
  '知识库中没有找到匹配的片段。可以换个说法、去掉不必要的限定词，或先用 kb_list_documents 看看有哪些资料；不要反复重试同一个查询。'
