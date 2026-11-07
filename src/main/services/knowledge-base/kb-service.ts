import { createHash, randomUUID } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { basename, extname, isAbsolute, resolve } from 'node:path'

import {
  KB_CATEGORY_PATTERN,
  KB_COSINE_MIN,
  KB_EMBEDDING_BATCH,
  KB_EMBEDDING_CONCURRENCY,
  KB_EMBEDDING_SCAN_LIMIT,
  KB_MAX_CHUNKS,
  KB_MAX_DOCUMENTS,
  KB_MAX_FILE_BYTES,
  KB_MAX_QUERY_CHARS,
  KB_RERANK_DOC_CHARS,
  KB_RERANK_TOP,
  KB_SEARCH_MAX_CHUNKS,
  KB_SEMANTIC_CANDIDATES,
  KB_SUPPORTED_EXTENSIONS,
  clipSegment,
  selectKbHits
} from '../../../shared/knowledge-base'
import type {
  KbDegradedReason,
  KbDocumentDetail,
  KbDocumentView,
  KbImportResult,
  KbImportSkip,
  KbListInput,
  KbProgressEvent,
  KbRerankState,
  KbSearchHit,
  KbSearchInput,
  KbSearchResult
} from '../../../shared/knowledge-base'
import { chunkText } from '../../../shared/kb-chunking'
import type { TextChunk } from '../../../shared/kb-chunking'
import { applyRerankScores, fuseKbHits, rankVectorCandidates } from '../../../shared/kb-retrieval'
import {
  buildMatchExpression,
  isSingleCjkChar,
  tokenizeForIndex,
  tokenizeQuery
} from '../../../shared/kb-tokenize'
import type {
  KbChunkInput,
  KbDocumentInput,
  KbVectorIndexRow,
  ToolboxStore
} from '../chat-store/chat-store'
import { decodeText } from '../library/encoding'
import { KbModelError, requestEmbeddings, requestRerank } from './kb-model-client'
import type { KbAiEndpointConfig } from '../settings/settings-service'

/** 导入过程中可观察的进度；IPC 层转成窗口事件，单测可忽略。 */
export interface KbImportOptions {
  category?: string
  onProgress?: (event: KbProgressEvent) => void
}

/** 审批卡只展示这些信息，不读取文件内容。 */
export interface KbPathPreview {
  path: string
  name: string
  size: number
}

/** 主进程只需要“按用途取配置”，测试可注入任意实现。 */
export interface KbModelSettings {
  getEmbeddingConfig(): Promise<KbAiEndpointConfig | null>
  getRerankConfig(): Promise<KbAiEndpointConfig | null>
}

/** 内存中的向量条目：元数据 + float32 向量，正文命中后再取。 */
interface CachedVectorEntry {
  chunkId: string
  vector: Float32Array
  documentId: string
  documentTitle: string
  category: string
  heading: string
  ordinal: number
  charCount: number
  startOffset: number
}

const DEFAULT_CATEGORY = 'work'
const MAX_TITLE_CHARS = 120
/** 关键词先取一批候选，再按上下文预算收敛，避免只拿 8 条候选时被单文档占满。 */
const KEYWORD_CANDIDATES = 20

const EXTENSIONS: readonly string[] = KB_SUPPORTED_EXTENSIONS

/**
 * 本地知识库服务：导入、重建、删除，以及“关键词 + 语义 + 重排”检索。
 *
 * 向量与重排都走当前启用档案的 OpenAI 兼容端点；没有配置时退回纯关键词，
 * 调用失败也只降级、不阻断检索。向量存在 SQLite BLOB 里，主进程内做余弦，
 * 2 万块以内直接扫描，超过上限明确提示而不拖垮内存。
 */
export class KnowledgeBaseService {
  private vectorCache: { model: string; entries: CachedVectorEntry[] } | null = null

  constructor(
    private readonly store: ToolboxStore,
    private readonly models?: KbModelSettings,
    private readonly fetchImpl: typeof fetch = globalThis.fetch
  ) {}

  async list(input: KbListInput = {}): Promise<KbDocumentView[]> {
    return this.store.listKbDocuments(input, await this.coverageModel())
  }

  async detail(documentId: string, chunkId?: string): Promise<KbDocumentDetail> {
    const document = this.requireDocument(documentId, await this.coverageModel())
    const focus = chunkId && this.store.hasKbChunk(documentId, chunkId) ? chunkId : null
    return {
      document,
      sourcePath: this.store.kbDocumentSourcePath(documentId) ?? '',
      chunks: this.store.listKbChunkPreviews(documentId),
      focusChunkId: focus
    }
  }

  /**
   * 覆盖率按“当前生效的向量模型”统计；换模型后旧向量不算补齐。
   * 配置读取失败时用不会命中的哨兵值，避免把旧模型的覆盖伪装成已完成。
   */
  private async coverageModel(): Promise<string> {
    if (!this.models) return ''
    try {
      return (await this.models.getEmbeddingConfig())?.model ?? ''
    } catch {
      return '\u0000'
    }
  }

  /**
   * 是否会把正文发给向量接口：导入审批卡与界面隐私提示用。
   * 配置存在但 Key 解密失败时按“已配置”处理，宁可多提示一次。
   */
  async embeddingConfigured(): Promise<boolean> {
    if (!this.models) return false
    try {
      return Boolean(await this.models.getEmbeddingConfig())
    } catch {
      return true
    }
  }

  /** 导入前的静态校验：绝对路径、白名单扩展名、存在、大小；不读内容。 */
  async inspectPath(input: string): Promise<KbPathPreview> {
    if (!isAbsolute(input)) throw new Error('请提供文件的绝对路径')
    const path = resolve(input)
    const extension = extname(path).toLowerCase()
    if (!EXTENSIONS.includes(extension)) throw new Error('仅支持 .md / .txt 文件')
    const info = await stat(path).catch(() => null)
    if (!info?.isFile()) throw new Error('文件不存在或不是普通文件')
    if (info.size === 0) throw new Error('文件是空的')
    if (info.size > KB_MAX_FILE_BYTES) throw new Error('文件超过 10MB 上限')
    return { path, name: basename(path), size: info.size }
  }

  /**
   * 逐个导入；单个文件失败不打断其余文件。
   * 已写入文档行但索引失败时保留 `failed` 状态，用户可在列表里重建。
   * 向量化失败不影响关键词可用，只在 `error` 里留下可读提示。
   */
  async importPaths(paths: string[], options: KbImportOptions = {}): Promise<KbImportResult> {
    if (paths.length === 0) throw new Error('请选择要导入的文件')
    const category = options.category ?? DEFAULT_CATEGORY
    if (!KB_CATEGORY_PATTERN.test(category)) throw new Error('资料类别无效')

    const imported: KbDocumentView[] = []
    const skipped: KbImportSkip[] = []
    const total = paths.length

    for (let index = 0; index < paths.length; index += 1) {
      const raw = paths[index]
      let documentId = ''
      let title = basename(raw, extname(raw)).slice(0, MAX_TITLE_CHARS) || '未命名资料'

      const report = (phase: KbProgressEvent['phase'], message?: string): void => {
        options.onProgress?.({
          documentId,
          title,
          phase,
          done: phase === 'ready' || phase === 'failed' ? index + 1 : index,
          total,
          ...(message ? { message } : {})
        })
      }

      try {
        const info = await this.inspectPath(raw)
        title = basename(info.path, extname(info.path)).slice(0, MAX_TITLE_CHARS) || '未命名资料'
        report('reading')
        const bytes = await readFile(info.path)
        const sha256 = createHash('sha256').update(bytes).digest('hex')
        const duplicate = this.store.findKbDocumentBySha(sha256)
        if (duplicate) {
          skipped.push({ path: info.path, reason: `已导入（${duplicate.title}）` })
          continue
        }
        if (this.store.countKbDocuments() >= KB_MAX_DOCUMENTS) {
          skipped.push({ path: info.path, reason: `最多 ${KB_MAX_DOCUMENTS} 篇资料` })
          continue
        }

        report('chunking')
        const chunks = chunkText(decodeText(bytes).text)
        if (chunks.length === 0) {
          skipped.push({ path: info.path, reason: '没有可索引的文本' })
          continue
        }
        if (this.store.countKbChunks() + chunks.length > KB_MAX_CHUNKS) {
          skipped.push({ path: info.path, reason: `知识库总块数超过 ${KB_MAX_CHUNKS} 上限` })
          continue
        }

        const now = Date.now()
        const id = randomUUID()
        const document: KbDocumentInput = {
          id,
          title,
          category,
          sourcePath: info.path,
          fileSize: info.size,
          sha256,
          createdAtMs: now,
          updatedAtMs: now
        }
        this.store.kbCreateDocument(document)
        // 只有落库成功后才记为「已建行」；否则失败应按跳过处理，而不是去改不存在的行。
        documentId = id
        report('indexing')
        this.store.kbReplaceChunks(documentId, this.toChunkRows(chunks))
        // 旧块已被替换，缓存里的向量 / 元数据立即失效（即使本机没配向量模型）。
        this.invalidateVectors()
        const warning = await this.embedPending(documentId, (done, embedTotal) => {
          options.onProgress?.({
            documentId,
            title,
            phase: 'embedding',
            done: index,
            total,
            embedding: { done, total: embedTotal }
          })
        })
        this.store.kbSetDocumentStatus(documentId, 'ready', chunks.length, warning)
        imported.push(this.requireDocument(documentId, await this.coverageModel()))
        report('ready')
      } catch (error) {
        const message = describeKbError(error)
        if (documentId) {
          this.store.kbSetDocumentStatus(documentId, 'failed', 0, message)
          imported.push(this.requireDocument(documentId, await this.coverageModel()))
          report('failed', message)
        } else {
          skipped.push({ path: raw, reason: message })
        }
      }
    }

    return { imported, skipped }
  }

  /** 整篇重建：源文件变化时同步标题、大小与 sha，并重新生成向量。 */
  async reindex(documentId: string, options: KbImportOptions = {}): Promise<KbDocumentView> {
    const document = this.requireDocument(documentId)
    const sourcePath = this.store.kbDocumentSourcePath(documentId)
    if (!sourcePath) throw new Error('资料缺少源文件路径，请删除后重新导入')

    const info = await this.inspectPath(sourcePath).catch(() => {
      throw new Error('源文件已不存在或不可读，请重新导入')
    })
    const bytes = await readFile(info.path)
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    const duplicate = this.store.findKbDocumentBySha(sha256)
    if (duplicate && duplicate.id !== documentId) {
      throw new Error(`内容与「${duplicate.title}」相同，请删除其中一篇后再重建`)
    }

    const chunks = chunkText(decodeText(bytes).text)
    if (chunks.length === 0) throw new Error('没有可索引的文本')
    if (this.store.countKbChunks() - document.chunkCount + chunks.length > KB_MAX_CHUNKS) {
      throw new Error(`知识库总块数超过 ${KB_MAX_CHUNKS} 上限`)
    }

    this.store.kbUpdateDocumentSource(documentId, {
      title: basename(info.path, extname(info.path)).slice(0, MAX_TITLE_CHARS) || document.title,
      fileSize: info.size,
      sha256,
      updatedAtMs: Date.now()
    })
    this.store.kbSetDocumentStatus(documentId, 'indexing', 0, '')
    options.onProgress?.({
      documentId,
      title: document.title,
      phase: 'indexing',
      done: 0,
      total: 1
    })
    try {
      this.store.kbReplaceChunks(documentId, this.toChunkRows(chunks))
      this.invalidateVectors()
      const warning = await this.embedPending(documentId, (done, embedTotal) => {
        options.onProgress?.({
          documentId,
          title: document.title,
          phase: 'embedding',
          done: 0,
          total: 1,
          embedding: { done, total: embedTotal }
        })
      })
      this.store.kbSetDocumentStatus(documentId, 'ready', chunks.length, warning)
    } catch (error) {
      const message = describeKbError(error)
      this.store.kbSetDocumentStatus(documentId, 'failed', 0, message)
      throw new Error(message, { cause: error })
    }
    const updated = this.requireDocument(documentId, await this.coverageModel())
    options.onProgress?.({
      documentId,
      title: updated.title,
      phase: 'ready',
      done: 1,
      total: 1
    })
    return updated
  }

  remove(documentId: string): void {
    this.requireDocument(documentId)
    this.store.deleteKbDocument(documentId)
    this.invalidateVectors()
  }

  /**
   * 检索：关键词 + 语义（可选）→ RRF → 重排（可选）→ 8 段 / 6000 字预算。
   * 任一步不可用都如实返回降级原因，绝不假装语义检索成功。
   */
  async search(input: KbSearchInput): Promise<KbSearchResult> {
    const query = (input.query ?? '').trim()
    const mode = input.mode ?? 'hybrid'
    if (!query) {
      return {
        query,
        mode: 'keyword',
        hits: [],
        degraded: null,
        message: '',
        rerank: 'off',
        keywordCount: 0,
        semanticCount: 0,
        totalChars: 0,
        dropped: 0
      }
    }
    if (query.length > KB_MAX_QUERY_CHARS) {
      throw new Error(`检索词最多 ${KB_MAX_QUERY_CHARS} 字`)
    }

    const keyword = this.keywordHits(query, input.category)
    let semantic: KbSearchHit[] = []
    let degraded: KbDegradedReason | null = null
    let message = ''
    if (mode !== 'keyword') {
      const result = await this.trySemantic(query, input.category)
      semantic = result.hits
      degraded = result.degraded
      message = result.message
    }

    let fused: KbSearchHit[]
    if (mode === 'keyword') fused = keyword
    else if (mode === 'semantic') fused = degraded ? keyword : semantic
    else fused = fuseKbHits(keyword, semantic)

    let rerank: KbRerankState = 'off'
    if (fused.length > 1) {
      const result = await this.tryRerank(query, fused)
      fused = result.hits
      rerank = result.state
      message = joinMessages(message, result.message)
    }

    const selected = selectKbHits(fused, {
      // 对话侧默认 8 段；手动调参最多允许 20 段，字符预算仍然生效。
      maxChunks: Math.min(input.topK ?? KB_SEARCH_MAX_CHUNKS, 20)
    })
    return {
      query,
      mode: mode !== 'keyword' && !degraded ? 'hybrid' : 'keyword',
      hits: selected.hits,
      degraded,
      message,
      rerank,
      keywordCount: keyword.length,
      semanticCount: semantic.length,
      totalChars: selected.totalChars,
      dropped: selected.dropped
    }
  }

  private keywordHits(query: string, category?: string): KbSearchHit[] {
    const tokens = tokenizeQuery(query)
    let rows = tokens.length
      ? this.store.searchKbChunks({
          match: buildMatchExpression(tokens),
          limit: KEYWORD_CANDIDATES,
          category: category ?? ''
        })
      : []
    // 单个汉字没有二元组可查，按内容扫描兜底。
    if (rows.length === 0 && isSingleCjkChar(query)) {
      rows = this.store.searchKbChunksByText(query, KEYWORD_CANDIDATES, category ?? '')
    }
    return rows
  }

  /** 语义召回；没有模型 / 没有向量 / 调用失败都返回可读降级原因。 */
  private async trySemantic(
    query: string,
    category?: string
  ): Promise<{ hits: KbSearchHit[]; degraded: KbDegradedReason | null; message: string }> {
    const none = (degraded: KbDegradedReason, message: string) => ({
      hits: [] as KbSearchHit[],
      degraded,
      message
    })
    if (!this.models) {
      return none('no-embedding', '未配置向量模型，本次仅使用关键词检索。')
    }

    let config: KbAiEndpointConfig | null
    try {
      config = await this.models.getEmbeddingConfig()
    } catch (error) {
      return none(
        'embedding-failed',
        `读取向量配置失败：${errorMessage(error)}，本次仅使用关键词检索。`
      )
    }
    if (!config) return none('no-embedding', '未配置向量模型，本次仅使用关键词检索。')

    let vectorCount: number
    try {
      vectorCount = this.store.kbCountVectors(config.model)
    } catch (error) {
      return none('embedding-failed', `读取向量索引失败：${errorMessage(error)}`)
    }
    if (vectorCount === 0) {
      // 之前导入时向量化失败过：把真实原因交回界面，而不是笼统说“没向量”。
      const failed = this.store
        .listKbDocuments({})
        .find((document) => document.status === 'ready' && document.error)
      if (failed?.error) {
        return none('embedding-failed', `${failed.error}，本次仅使用关键词检索。`)
      }
      return none(
        'no-vectors',
        '资料还没有向量，本次仅使用关键词检索；可在资料库点「补齐向量」。'
      )
    }
    if (vectorCount > KB_EMBEDDING_SCAN_LIMIT) {
      return none(
        'too-many-vectors',
        `向量块已超过 ${KB_EMBEDDING_SCAN_LIMIT}，本次仅使用关键词检索。`
      )
    }

    try {
      const [queryVector] = await requestEmbeddings(config, [query], {
        fetchImpl: this.fetchImpl
      })
      if (!queryVector) return none('embedding-failed', '向量服务没有返回查询向量。')
      const entries = this.loadVectorIndex(config.model).filter(
        (entry) => !category || entry.category === category
      )
      if (entries.length === 0) {
        return none(
          'no-vectors',
          '该类别下还没有向量，本次仅使用关键词检索；可在资料库点「补齐向量」。'
        )
      }
      const ranked = rankVectorCandidates(
        queryVector,
        entries,
        KB_SEMANTIC_CANDIDATES,
        KB_COSINE_MIN
      )
      const hits: KbSearchHit[] = []
      for (const candidate of ranked) {
        const chunk = this.store.kbGetChunkHit(candidate.chunkId)
        if (!chunk) continue
        hits.push({ ...chunk, score: candidate.score })
      }
      return { hits, degraded: null, message: '' }
    } catch (error) {
      return none(
        'embedding-failed',
        `${errorMessage(error)}，本次仅使用关键词检索。`
      )
    }
  }

  /** 重排前 `KB_RERANK_TOP` 段；失败保持融合顺序并说明。 */
  private async tryRerank(
    query: string,
    hits: KbSearchHit[]
  ): Promise<{ hits: KbSearchHit[]; state: KbRerankState; message: string }> {
    const off = { hits, state: 'off' as KbRerankState, message: '' }
    if (!this.models) return off
    let config: KbAiEndpointConfig | null
    try {
      config = await this.models.getRerankConfig()
    } catch (error) {
      return {
        hits,
        state: 'failed',
        message: `读取重排配置失败：${errorMessage(error)}，保持融合排序。`
      }
    }
    if (!config) return off

    const candidates = hits.slice(0, KB_RERANK_TOP)
    try {
      const scores = await requestRerank(
        config,
        query,
        candidates.map((hit) => clipSegment(hit.content, KB_RERANK_DOC_CHARS)),
        { fetchImpl: this.fetchImpl }
      )
      return {
        hits: [...applyRerankScores(candidates, scores), ...hits.slice(KB_RERANK_TOP)],
        state: 'applied',
        message: ''
      }
    } catch (error) {
      return {
        hits,
        state: 'failed',
        message: `${errorMessage(error)}，保持融合排序。`
      }
    }
  }

  /**
   * 给一篇文档补齐缺失 / 换模型后的向量。
   * 返回空串表示成功或无配置；否则返回可展示的失败原因（关键词仍可用）。
   */
  private async embedPending(
    documentId: string,
    onBatch?: (done: number, total: number) => void
  ): Promise<string> {
    if (!this.models) return ''
    try {
      const config = await this.models.getEmbeddingConfig()
      if (!config) return ''
      const pending = this.store.kbPendingEmbeddingChunks(config.model, documentId)
      if (pending.length === 0) {
        this.invalidateVectors()
        return ''
      }

      const batches: Array<typeof pending> = []
      for (let index = 0; index < pending.length; index += KB_EMBEDDING_BATCH) {
        batches.push(pending.slice(index, index + KB_EMBEDDING_BATCH))
      }
      onBatch?.(0, batches.length)

      let completed = 0
      for (let index = 0; index < batches.length; index += KB_EMBEDDING_CONCURRENCY) {
        const group = batches.slice(index, index + KB_EMBEDDING_CONCURRENCY)
        const vectors = await Promise.all(
          group.map((batch) =>
            requestEmbeddings(
              config,
              batch.map((chunk) =>
                chunk.heading ? `${chunk.heading}\n${chunk.content}` : chunk.content
              ),
              { fetchImpl: this.fetchImpl }
            )
          )
        )
        const rows: Array<{
          id: string
          embedding: Buffer
          model: string
          dim: number
        }> = []
        group.forEach((batch, groupIndex) => {
          const batchVectors = vectors[groupIndex]
          batch.forEach((chunk, chunkIndex) => {
            const vector = batchVectors[chunkIndex]
            if (!vector) return
            rows.push({
              id: chunk.id,
              embedding: float32ToBuffer(vector),
              model: config.model,
              dim: vector.length
            })
          })
        })
        this.store.kbSetChunkEmbeddings(rows)
        completed += group.length
        onBatch?.(completed, batches.length)
      }
      this.invalidateVectors()
      return ''
    } catch (error) {
      this.invalidateVectors()
      return `${errorMessage(error)}（关键词检索仍可用）`
    }
  }

  /** 向量索引按模型缓存；导入、重建、删除后失效。 */
  private loadVectorIndex(model: string): CachedVectorEntry[] {
    if (this.vectorCache?.model === model) return this.vectorCache.entries
    const rows: KbVectorIndexRow[] = this.store.kbLoadVectorIndex(model)
    const entries: CachedVectorEntry[] = []
    for (const row of rows) {
      const vector = decodeVector(row.embedding)
      if (!vector || vector.length < 2) continue
      entries.push({
        chunkId: row.chunk_id,
        vector,
        documentId: row.document_id,
        documentTitle: row.document_title,
        category: row.category,
        heading: row.heading,
        ordinal: row.ordinal,
        charCount: row.char_count,
        startOffset: row.start_offset
      })
    }
    this.vectorCache = { model, entries }
    return entries
  }

  private invalidateVectors(): void {
    this.vectorCache = null
  }

  private toChunkRows(chunks: TextChunk[]): KbChunkInput[] {
    return chunks.map((chunk, ordinal) => ({
      id: randomUUID(),
      ordinal,
      heading: chunk.heading,
      content: chunk.content,
      startOffset: chunk.startOffset,
      charCount: chunk.charCount,
      // 标题也进索引：短块靠章节名补语义，标题命中用 bm25 列权重加权。
      tokens: tokenizeForIndex(`${chunk.heading}\n${chunk.content}`)
    }))
  }

  private requireDocument(documentId: string, embeddingModel = ''): KbDocumentView {
    const document = this.store.getKbDocument(documentId, embeddingModel)
    if (!document) throw new Error('资料不存在，请刷新列表')
    return document
  }
}

/** 唯一索引冲突（并发导入同一内容）转成用户能读懂的提示，不暴露 SQL。 */
function describeKbError(error: unknown): string {
  const message = error instanceof Error ? error.message : '导入失败'
  if (/UNIQUE constraint failed: kb_documents\.sha256/i.test(message)) return '已导入（相同内容）'
  return message
}

function errorMessage(error: unknown): string {
  if (error instanceof KbModelError) return error.message
  return error instanceof Error && error.message ? error.message : '未知原因'
}

function joinMessages(first: string, second: string): string {
  return [first, second].filter(Boolean).join(' ')
}

/** float32 小端 BLOB；写入前复制，避免引用外部 ArrayBuffer。 */
function float32ToBuffer(vector: Float32Array): Buffer {
  return Buffer.from(vector.buffer.slice(vector.byteOffset, vector.byteOffset + vector.byteLength))
}

/** BLOB → Float32Array；字节数不是 4 的倍数视为坏数据。 */
function decodeVector(blob: Buffer): Float32Array | null {
  if (!blob || blob.byteLength === 0 || blob.byteLength % 4 !== 0) return null
  const copy = new Uint8Array(blob.byteLength)
  copy.set(blob)
  return new Float32Array(copy.buffer)
}
