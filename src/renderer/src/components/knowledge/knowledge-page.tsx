import { useEffect } from 'react'
import type { JSX } from 'react'

import {
  KB_CATEGORIES,
  KB_PROGRESS_LABELS,
  KB_STATUS_LABELS,
  kbCategoryLabel
} from '../../../../shared/knowledge-base'
import type {
  KbDegradedReason,
  KbDocumentDetail,
  KbDocumentView,
  KbSearchResult
} from '../../../../shared/knowledge-base'
import { confirmDialog } from '../../stores/dialog-store'
import { useAppStore } from '../../stores/app-store'
import { useKnowledgeStore } from '../../stores/knowledge-store'
import { Dropdown } from '../dropdown'
import { SearchIcon } from '../icons'

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

const DEGRADED_LABELS: Record<KbDegradedReason, string> = {
  'no-embedding': '仅关键词｜未配置向量模型',
  'no-vectors': '仅关键词｜资料未向量化',
  'embedding-failed': '仅关键词｜向量调用失败',
  'too-many-vectors': '仅关键词｜向量块过多'
}

/** 首次把资料发给向量接口前提示一次；只影响本机浏览数据。 */
const EMBEDDING_NOTICE_KEY = 'toolbox.kb.embedding-notice-v1'

function formatTime(ms: number): string {
  return new Date(ms).toLocaleString('sv-SE').slice(0, 16)
}

/** 本地知识库：导入资料、关键词检索、分块预览与引用定位。 */
export function KnowledgePage(): JSX.Element {
  const documents = useKnowledgeStore((state) => state.documents)
  const loading = useKnowledgeStore((state) => state.loading)
  const loaded = useKnowledgeStore((state) => state.loaded)
  const error = useKnowledgeStore((state) => state.error)
  const query = useKnowledgeStore((state) => state.query)
  const category = useKnowledgeStore((state) => state.category)
  const result = useKnowledgeStore((state) => state.result)
  const searching = useKnowledgeStore((state) => state.searching)
  const importing = useKnowledgeStore((state) => state.importing)
  const summary = useKnowledgeStore((state) => state.summary)
  const progress = useKnowledgeStore((state) => state.progress)
  const detail = useKnowledgeStore((state) => state.detail)
  const setQuery = useKnowledgeStore((state) => state.setQuery)
  const setCategory = useKnowledgeStore((state) => state.setCategory)
  const search = useKnowledgeStore((state) => state.search)
  const clearSearch = useKnowledgeStore((state) => state.clearSearch)
  const importFiles = useKnowledgeStore((state) => state.importFiles)
  const reindex = useKnowledgeStore((state) => state.reindex)
  const backfillVectors = useKnowledgeStore((state) => state.backfillVectors)
  const remove = useKnowledgeStore((state) => state.remove)
  const open = useKnowledgeStore((state) => state.open)
  const closeDetail = useKnowledgeStore((state) => state.closeDetail)
  const load = useKnowledgeStore((state) => state.load)
  const settings = useAppStore((state) => state.settings)

  useEffect(() => {
    // 从其他页面切回来时总是重拉一次：Agent 可能在对话里导入或删过资料。
    void useKnowledgeStore.getState().load()
    return window.toolbox?.knowledge?.onProgress((event) => {
      useKnowledgeStore.getState().receiveProgress(event)
    })
  }, [])

  const confirmRemove = async (document: KbDocumentView): Promise<void> => {
    const confirmed = await confirmDialog(
      `确定删除「${document.title}」吗？该资料的 ${document.chunkCount} 个分块与索引会一并删除，源文件不受影响。`
    )
    if (confirmed) await remove(document.id)
  }

  const activeProfile =
    settings?.profiles.find((profile) => profile.id === settings.activeId) ?? null
  const embeddingConfigured = Boolean(activeProfile?.embeddingModel)
  const rerankConfigured = Boolean(activeProfile?.rerankModel)

  /** 配置了向量模型时，正文与查询会离开本机；首次操作前明确提示一次。 */
  const ensureEmbeddingNotice = async (): Promise<boolean> => {
    if (!embeddingConfigured) return true
    try {
      if (localStorage.getItem(EMBEDDING_NOTICE_KEY)) return true
      const confirmed = await confirmDialog(
        '已配置向量模型：导入资料时会把分块正文发送给该 AI 服务的 /embeddings 接口生成向量；检索时也会发送查询词。' +
          (rerankConfigured ? '配置了重排模型，检索时还会把候选片段发送给 /rerank。' : '') +
          '是否继续？'
      )
      if (confirmed) localStorage.setItem(EMBEDDING_NOTICE_KEY, '1')
      return confirmed
    } catch {
      // 本地存储不可用时仍允许继续，但下次会再次提示。
      return true
    }
  }

  const importWithNotice = async (): Promise<void> => {
    if (!(await ensureEmbeddingNotice())) return
    await importFiles()
  }

  const backfillWithNotice = async (): Promise<void> => {
    if (!(await ensureEmbeddingNotice())) return
    await backfillVectors()
  }

  if (detail) {
    return (
      <KnowledgeDetail
        detail={detail}
        embeddingConfigured={embeddingConfigured}
        onBack={closeDetail}
        onReindex={() => void reindex(detail.document.id)}
        onRemove={() => void confirmRemove(detail.document)}
      />
    )
  }

  const totalChunks = documents.reduce((sum, item) => sum + item.chunkCount, 0)
  const missingVectors = documents.filter(
    (document) => document.chunkCount > document.embeddedChunkCount
  )
  const categoryOptions = [
    { value: '', label: '全部资料' },
    ...KB_CATEGORIES.map((item) => ({ value: item.id, label: item.label }))
  ]

  return (
    <div className="view-enter kb-page">
      <div className="toolbar-row">
        <input
          className="field-input toolbar-search"
          type="search"
          placeholder="在资料里搜关键词，例如：部署、回滚"
          aria-label="检索知识库"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
            event.preventDefault()
            void search()
          }}
        />
        <button
          type="button"
          className="btn-ghost kb-search-button"
          disabled={searching || !query.trim()}
          onClick={() => void search()}
        >
          <SearchIcon />
          {searching ? '检索中…' : '检索'}
        </button>
        <Dropdown
          ariaLabel="资料类别"
          value={category}
          options={categoryOptions}
          onChange={(value) => void setCategory(value)}
        />
        <div className="toolbar-grow" />
        {embeddingConfigured && missingVectors.length > 0 ? (
          <button
            type="button"
            className="btn-ghost"
            disabled={importing || searching}
            title="对缺少向量的资料逐篇重建索引"
            onClick={() => void backfillWithNotice()}
          >
            补齐向量（{missingVectors.length}）
          </button>
        ) : null}
        <button
          type="button"
          className="btn-gold"
          disabled={importing}
          onClick={() => void importWithNotice()}
        >
          {importing ? '导入中…' : '导入资料'}
        </button>
      </div>

      {progress &&
      (progress.phase === 'reading' ||
        progress.phase === 'indexing' ||
        progress.phase === 'chunking' ||
        progress.phase === 'embedding') ? (
        <div className="status-banner kb-progress" role="status">
          {KB_PROGRESS_LABELS[progress.phase]}：《{progress.title || '资料'}》
          {progress.phase === 'embedding' && progress.embedding
            ? `（${progress.embedding.done}/${progress.embedding.total} 批）`
            : progress.total > 1
              ? `（${progress.done + 1}/${progress.total}）`
              : ''}
        </div>
      ) : null}
      {summary ? <div className="status-banner success-banner">{summary}</div> : null}
      {error ? (
        <div className="status-banner" role="alert">
          <span>{error}</span>
          <button type="button" className="btn-ghost" onClick={() => void load()}>
            重试
          </button>
        </div>
      ) : null}

      {result ? (
        <SearchResults
          result={result}
          onOpen={(documentId, chunkId) => void open(documentId, chunkId)}
          onClear={clearSearch}
        />
      ) : null}

      {loading && !loaded ? (
        <div>
          <div className="loading-skeleton" />
          <div className="loading-skeleton" />
        </div>
      ) : documents.length === 0 ? (
        <div className="message-empty">
          <p className="empty-text">还没有导入资料</p>
          <p className="kb-empty-hint">
            支持 .md 与 .txt，单篇不超过 10MB。导入后可在对话里直接提问，
            Agent 会自己判断要不要查这份资料。文档只在本机解析与检索。
            {embeddingConfigured
              ? '当前已配置向量模型：导入时会一并生成向量，分块正文会发送给该服务的 /embeddings。'
              : '想要语义检索，先在「设置 → 星轨链路」填写向量模型。'}
          </p>
          <button
            type="button"
            className="btn-ghost"
            onClick={() => void importWithNotice()}
            disabled={importing}
          >
            选择文件导入
          </button>
        </div>
      ) : (
        <>
          <div className="kb-summary-line">
            共 {documents.length} 篇 · {totalChunks} 段 ·{' '}
            {embeddingConfigured ? '关键词 + 语义检索' : '关键词检索（未配置向量模型）'}
          </div>
          <ul className="kb-list">
            {documents.map((document) => (
              <li key={document.id}>
                <div
                  className={`glass kb-row${document.status === 'failed' ? ' failed' : ''}${
                    document.status === 'ready' && document.error ? ' warning' : ''
                  }`}
                >
                  <button
                    type="button"
                    className="kb-row-main"
                    onClick={() => void open(document.id)}
                    title="查看分块"
                  >
                    <span className="kb-row-title">
                      <span className="kb-row-name">{document.title}</span>
                      <span className="kb-chip">{kbCategoryLabel(document.category)}</span>
                      {embeddingConfigured && document.chunkCount > 0 ? (
                        <span
                          className={`kb-vector${
                            document.embeddedChunkCount < document.chunkCount ? ' pending' : ''
                          }`}
                        >
                          向量 {document.embeddedChunkCount}/{document.chunkCount}
                        </span>
                      ) : null}
                    </span>
                    <span className="kb-row-meta">
                      {document.fileName} · {document.chunkCount} 段 ·{' '}
                      {formatSize(document.fileSize)}
                    </span>
                    {document.error ? (
                      <span
                        className={`kb-row-error${document.status === 'ready' ? ' warn' : ''}`}
                      >
                        {document.error}
                      </span>
                    ) : null}
                  </button>
                  <span className={`kb-status ${document.status}`}>
                    {KB_STATUS_LABELS[document.status]}
                  </span>
                  <span className="kb-row-time">{formatTime(document.updatedAtMs)}</span>
                  <button
                    type="button"
                    className="btn-ghost kb-row-action"
                    onClick={() => void reindex(document.id)}
                  >
                    重建
                  </button>
                  <button
                    type="button"
                    className="btn-ghost btn-danger kb-row-action"
                    onClick={() => void confirmRemove(document)}
                  >
                    删除
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}

function SearchResults({
  result,
  onOpen,
  onClear
}: {
  result: KbSearchResult
  onOpen: (documentId: string, chunkId: string) => void
  onClear: () => void
}): JSX.Element {
  const degradedLabel = result.degraded ? DEGRADED_LABELS[result.degraded] : ''
  return (
    <section className="kb-hits" aria-label="检索结果">
      <div className="kb-hits-head">
        <span>
          「{result.query}」命中 {result.hits.length} 段
        </span>
        {result.degraded ? (
          <span className="kb-degraded">{degradedLabel}</span>
        ) : (
          <span className="kb-mode">
            {result.mode === 'hybrid' ? '关键词 + 语义' : '关键词'}
          </span>
        )}
        {result.rerank === 'applied' ? <span className="kb-mode">已重排</span> : null}
        {result.rerank === 'failed' ? (
          <span className="kb-degraded">重排失败</span>
        ) : null}
        <span className="kb-counts">
          关键词 {result.keywordCount} · 语义 {result.semanticCount}
        </span>
        {result.dropped > 0 ? (
          <span className="kb-degraded">另有 {result.dropped} 段未展开</span>
        ) : null}
        <div className="toolbar-grow" />
        <button type="button" className="btn-ghost" onClick={onClear}>
          清除
        </button>
      </div>
      {result.message ? <p className="kb-degraded-note">{result.message}</p> : null}
      {result.hits.length === 0 ? (
        <p className="kb-empty-hint">
          没有命中。换个说法或更短的关键词试试；也可以先点开文档看看章节标题。
        </p>
      ) : (
        <ul className="kb-hit-list">
          {result.hits.map((hit) => (
            <li key={hit.chunkId}>
              <button
                type="button"
                className="glass kb-hit"
                onClick={() => onOpen(hit.documentId, hit.chunkId)}
              >
                <span className="kb-hit-head">
                  <span className="kb-hit-doc">{hit.documentTitle}</span>
                  {hit.heading ? (
                    <span className="kb-hit-heading">{hit.heading}</span>
                  ) : null}
                  <span className="kb-hit-index">第 {hit.ordinal + 1} 段</span>
                </span>
                <span className="kb-snippet">{hit.content}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function KnowledgeDetail({
  detail,
  embeddingConfigured,
  onBack,
  onReindex,
  onRemove
}: {
  detail: KbDocumentDetail
  embeddingConfigured: boolean
  onBack: () => void
  onReindex: () => void
  onRemove: () => void
}): JSX.Element {
  const doc = detail.document

  useEffect(() => {
    if (!detail.focusChunkId) return
    document.getElementById(`kb-chunk-${detail.focusChunkId}`)?.scrollIntoView({
      block: 'center'
    })
  }, [detail.focusChunkId])

  return (
    <div className="view-enter kb-page">
      <div className="toolbar-row">
        <button type="button" className="btn-ghost" onClick={onBack}>
          ← 返回资料库
        </button>
        <span className="kb-detail-title">{doc.title}</span>
        <div className="toolbar-grow" />
        <button type="button" className="btn-ghost" onClick={onReindex}>
          重建索引
        </button>
        <button type="button" className="btn-ghost btn-danger" onClick={onRemove}>
          删除
        </button>
      </div>

      <div className="kb-detail-meta">
        <span className="kb-chip">{kbCategoryLabel(doc.category)}</span>
        <span>{detail.chunks.length} 段</span>
        <span>{formatSize(doc.fileSize)}</span>
        <span>
          {embeddingConfigured
            ? `向量 ${doc.embeddedChunkCount}/${doc.chunkCount}`
            : '未启用语义检索'}
        </span>
        <span>更新于 {formatTime(doc.updatedAtMs)}</span>
        <span className={`kb-status ${doc.status}`}>{KB_STATUS_LABELS[doc.status]}</span>
      </div>
      <div className="kb-source" title={detail.sourcePath}>
        {detail.sourcePath}
      </div>

      {doc.status === 'failed' && doc.error ? (
        <div className="status-banner" role="alert">
          <span>索引失败：{doc.error}</span>
          <button type="button" className="btn-ghost" onClick={onReindex}>
            重建
          </button>
        </div>
      ) : null}

      {doc.status !== 'failed' && doc.error ? (
        <div className="status-banner kb-warning" role="status">
          <span>{doc.error}</span>
          <button type="button" className="btn-ghost" onClick={onReindex}>
            重试向量化
          </button>
        </div>
      ) : null}

      {detail.chunks.length === 0 ? (
        <div className="message-empty">
          <p className="empty-text">这篇资料还没有分块，点「重建索引」重新解析。</p>
        </div>
      ) : (
        <ol className="kb-chunk-list">
          {detail.chunks.map((chunk) => (
            <li
              key={chunk.id}
              id={`kb-chunk-${chunk.id}`}
              className={`glass kb-chunk${chunk.id === detail.focusChunkId ? ' focused' : ''}`}
            >
              <div className="kb-chunk-head">
                <span className="kb-chunk-index">#{chunk.ordinal + 1}</span>
                {chunk.heading ? (
                  <span className="kb-chunk-heading">{chunk.heading}</span>
                ) : null}
                <span className="kb-chunk-count">{chunk.charCount} 字</span>
              </div>
              <p className="kb-chunk-text">{chunk.preview}</p>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
