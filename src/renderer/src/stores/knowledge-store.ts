import { create } from 'zustand'

import type {
  KbDocumentDetail,
  KbDocumentView,
  KbListInput,
  KbProgressEvent,
  KbSearchResult
} from '../../../shared/knowledge-base'

interface KnowledgeState {
  documents: KbDocumentView[]
  loading: boolean
  loaded: boolean
  error: string
  query: string
  /** 空串表示全部类别。 */
  category: string
  result: KbSearchResult | null
  searching: boolean
  importing: boolean
  /** 导入 / 重建结束后的结果提示，显示在工具栏下方。 */
  summary: string
  progress: KbProgressEvent | null
  detail: KbDocumentDetail | null

  load(input?: KbListInput): Promise<void>
  importFiles(): Promise<void>
  reindex(documentId: string): Promise<void>
  /** 逐篇重建，补齐缺失或换模型后的向量；不新增 IPC。 */
  backfillVectors(): Promise<void>
  remove(documentId: string): Promise<void>
  search(): Promise<void>
  clearSearch(): void
  setQuery(query: string): void
  setCategory(category: string): Promise<void>
  open(documentId: string, chunkId?: string): Promise<void>
  closeDetail(): void
  receiveProgress(event: KbProgressEvent): void
}

function messageOf(error: unknown): string {
  return error instanceof Error && error.message ? error.message : '操作失败，请稍后重试'
}

export const useKnowledgeStore = create<KnowledgeState>((set, get) => ({
  documents: [],
  loading: false,
  loaded: false,
  error: '',
  query: '',
  category: '',
  result: null,
  searching: false,
  importing: false,
  summary: '',
  progress: null,
  detail: null,

  load: async (input = {}) => {
    const bridge = window.toolbox?.knowledge
    if (!bridge) {
      set({ loading: false, error: '本地桥接未就绪，暂时无法读取知识库' })
      return
    }
    set({ loading: true, error: '' })
    try {
      const documents = await bridge.list({
        ...input,
        category: input.category ?? (get().category || undefined)
      })
      set({ documents, loading: false, loaded: true })
    } catch (error) {
      set({ loading: false, error: messageOf(error) })
    }
  },

  importFiles: async () => {
    const bridge = window.toolbox?.knowledge
    if (!bridge || get().importing) return
    set({ importing: true, error: '', summary: '' })
    try {
      const result = await bridge.importFiles({
        category: get().category || undefined
      })
      if (!result) {
        // 用户取消了文件框：不提示成功，也不刷新列表。
        set({ importing: false, progress: null })
        return
      }
      const parts: string[] = []
      if (result.imported.length > 0) {
        const failed = result.imported.filter((item) => item.status === 'failed').length
        const vectorFailed = result.imported.filter(
          (item) => item.status === 'ready' && item.error
        ).length
        parts.push(`已导入 ${result.imported.length - failed} 篇`)
        if (failed > 0) parts.push(`${failed} 篇索引失败，可在列表里重建`)
        if (vectorFailed > 0) parts.push(`${vectorFailed} 篇向量化失败（关键词仍可用）`)
      }
      if (result.skipped.length > 0) {
        parts.push(
          `跳过 ${result.skipped.length} 篇（${result.skipped[0].reason}${
            result.skipped.length > 1 ? ' 等' : ''
          }）`
        )
      }
      set({
        summary: parts.length > 0 ? parts.join('，') : '没有可导入的文件',
        importing: false,
        progress: null
      })
      await get().load()
    } catch (error) {
      set({ importing: false, progress: null, error: messageOf(error) })
    }
  },

  reindex: async (documentId) => {
    const bridge = window.toolbox?.knowledge
    if (!bridge) return
    set({ error: '', summary: '' })
    try {
      const updated = await bridge.reindex(documentId)
      set((state) => ({
        documents: state.documents.map((item) =>
          item.id === updated.id ? updated : item
        ),
        summary: `已重建「${updated.title}」，共 ${updated.chunkCount} 段`,
        progress: null
      }))
      if (get().detail?.document.id === documentId) {
        await get().open(documentId)
      }
    } catch (error) {
      set({ error: messageOf(error), progress: null })
    }
  },

  backfillVectors: async () => {
    const bridge = window.toolbox?.knowledge
    if (!bridge) return
    const targets = get().documents.filter(
      (document) => document.chunkCount > document.embeddedChunkCount
    )
    if (targets.length === 0) {
      set({ summary: '所有资料都已生成向量' })
      return
    }
    set({ error: '', summary: '' })
    const failures: string[] = []
    let done = 0
    for (const target of targets) {
      try {
        const updated = await bridge.reindex(target.id)
        set((state) => ({
          documents: state.documents.map((item) =>
            item.id === updated.id ? updated : item
          )
        }))
        if (updated.error || updated.embeddedChunkCount < updated.chunkCount) {
          failures.push(`${target.title}：${updated.error || '向量未生成'}`)
        } else {
          done += 1
        }
        set({ summary: `正在补齐向量 ${done + failures.length}/${targets.length}…` })
      } catch (error) {
        failures.push(`${target.title}：${messageOf(error)}`)
        set({ summary: `正在补齐向量 ${done + failures.length}/${targets.length}…` })
      }
    }
    set({
      progress: null,
      summary:
        failures.length > 0
          ? `已补齐 ${done} 篇，${failures.length} 篇失败（${failures[0]}）`
          : `已为 ${done} 篇资料补齐向量`
    })
  },

  remove: async (documentId) => {
    const bridge = window.toolbox?.knowledge
    if (!bridge) return
    try {
      await bridge.remove(documentId)
      set((state) => ({
        documents: state.documents.filter((item) => item.id !== documentId),
        detail: state.detail?.document.id === documentId ? null : state.detail,
        result:
          state.result?.hits.some((hit) => hit.documentId === documentId)
            ? null
            : state.result,
        summary: '已删除该资料及其分块，源文件未改动'
      }))
    } catch (error) {
      set({ error: messageOf(error) })
    }
  },

  search: async () => {
    const bridge = window.toolbox?.knowledge
    if (!bridge) return
    const query = get().query.trim()
    if (!query) {
      set({ result: null })
      return
    }
    set({ searching: true, error: '' })
    try {
      const result = await bridge.search({
        query,
        category: get().category || undefined,
        mode: 'hybrid',
        topK: 8
      })
      set({ result, searching: false })
    } catch (error) {
      set({ searching: false, error: messageOf(error) })
    }
  },

  clearSearch: () => set({ result: null, query: '' }),
  setQuery: (query) => set({ query }),

  setCategory: async (category) => {
    set({ category, result: null })
    await get().load({ category: category || undefined })
  },

  open: async (documentId, chunkId) => {
    const bridge = window.toolbox?.knowledge
    if (!bridge) throw new Error('本地桥接未就绪，暂时无法打开资料')
    const detail = await bridge.document(documentId, chunkId)
    set({ detail })
  },

  closeDetail: () => set({ detail: null }),

  receiveProgress: (event) => {
    set({ progress: event })
    if (event.phase === 'ready' || event.phase === 'failed') {
      // 索引进度只用于提示；最终状态以列表为准，完成后重新拉一次。
      void get().load()
    }
  }
}))
