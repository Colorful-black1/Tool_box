import { describe, expect, it, vi } from 'vitest'

import type {
  KbDocumentView,
  KbSearchResult
} from '../../../../shared/knowledge-base'
import type { AgentDeps } from './deps'
import { knowledgeTools } from './knowledge'
import type { AgentToolContext } from '../tool-registry'

const document: KbDocumentView = {
  id: 'doc1',
  title: '部署说明',
  category: 'work',
  fileName: '部署说明.md',
  fileSize: 2048,
  status: 'ready',
  chunkCount: 2,
  embeddedChunkCount: 2,
  error: '',
  createdAtMs: 1,
  updatedAtMs: 2
}

const search: KbSearchResult = {
  query: '回滚',
  mode: 'keyword',
  degraded: 'no-embedding',
  message: '未配置向量模型，本次仅使用关键词检索。',
  rerank: 'off',
  keywordCount: 1,
  semanticCount: 0,
  totalChars: 20,
  dropped: 0,
  hits: [
    {
      chunkId: 'chunk1',
      documentId: 'doc1',
      documentTitle: '部署说明',
      category: 'work',
      heading: '部署 > 回滚',
      ordinal: 0,
      charCount: 20,
      content: '数据库回滚要先恢复备份。',
      startOffset: 0,
      score: -0.001
    }
  ]
}

function setup() {
  const service = {
    list: vi.fn(() => [document]),
    search: vi.fn(() => search),
    detail: vi.fn(() => ({
      document,
      sourcePath: 'C:\\资料\\部署说明.md',
      chunks: [],
      focusChunkId: null
    })),
    inspectPath: vi.fn(async () => ({
      path: 'C:\\资料\\部署说明.md',
      name: '部署说明.md',
      size: 2048
    })),
    embeddingConfigured: vi.fn(async () => false),
    importPaths: vi.fn(async () => ({ imported: [document], skipped: [] })),
    remove: vi.fn()
  }
  const tools = knowledgeTools({ knowledge: service } as unknown as AgentDeps)
  const tool = (name: string) => {
    const found = tools.find((item) => item.name === name)
    if (!found) throw new Error(`缺少工具 ${name}`)
    return found
  }
  return { service, tool }
}

const ctx = {} as AgentToolContext

describe('知识库 Agent 工具', () => {
  it('检索结果带正文、降级说明与分块引用', async () => {
    const { tool } = setup()
    const definition = tool('kb_search')
    const result = (await definition.handler({ query: '回滚' }, ctx)) as {
      text: string
      count: number
      degraded: string | null
      hits: Array<{ chunkId: string }>
    }

    expect(result.count).toBe(1)
    expect(result.degraded).toBe('no-embedding')
    expect(result.text).toContain('数据库回滚要先恢复备份。')
    expect(result.text).toContain('仅使用关键词检索')
    const references = definition.references?.({}, result) ?? []
    expect(references[0].target).toEqual({ kind: 'kb', id: 'doc1', chunkId: 'chunk1' })
  })

  it('列目录返回块数与类别标签', async () => {
    const { tool } = setup()
    const result = (await tool('kb_list_documents').handler({}, ctx)) as {
      total: number
      documents: Array<{ categoryLabel: string; fileSize: string }>
    }

    expect(result.total).toBe(1)
    expect(result.documents[0].categoryLabel).toBe('工作资料')
    expect(result.documents[0].fileSize).toBe('2.0 KB')
  })

  it('导入先校验路径再等审批；审批通过后才真正写入', async () => {
    const { service, tool } = setup()
    const definition = tool('kb_add_document')
    const prepared = await definition.prepare?.(
      { path: 'C:\\资料\\部署说明.md', category: 'work' },
      ctx
    )

    expect(service.inspectPath).toHaveBeenCalledWith('C:\\资料\\部署说明.md')
    expect(service.importPaths).not.toHaveBeenCalled()
    expect(prepared?.args).toContain('C:\\资料\\部署说明.md')
    expect(prepared?.args).toContain('2.0 KB')
    expect(prepared?.args).toContain('工作资料')
    expect(prepared?.args).toContain('不发送到网络')
    expect(prepared?.requireApproval).toBe(false)

    await prepared?.execute()
    expect(service.importPaths).toHaveBeenCalledWith(['C:\\资料\\部署说明.md'], {
      category: 'work'
    })
  })

  it('配置向量模型时导入审批卡说明正文会外发', async () => {
    const { service, tool } = setup()
    service.embeddingConfigured.mockResolvedValueOnce(true)
    const prepared = await tool('kb_add_document').prepare?.(
      { path: 'C:\\资料\\部署说明.md' },
      ctx
    )
    expect(prepared?.args).toContain('/embeddings')
    expect(prepared?.args).toContain('分块正文')
    expect(prepared?.requireApproval).toBe(true)
  })

  it('删除审批卡展示标题、块数与源文件，执行后删除且不动源文件', async () => {
    const { service, tool } = setup()
    const definition = tool('kb_remove_document')
    const prepared = await definition.prepare?.({ documentId: 'doc1' }, ctx)

    expect(prepared?.args).toContain('部署说明')
    expect(prepared?.args).toContain('2')
    expect(prepared?.args).toContain('C:\\资料\\部署说明.md')
    expect(prepared?.args).toContain('源文件不受影响')

    await prepared?.execute()
    expect(service.remove).toHaveBeenCalledWith('doc1')
  })

  it('没有知识库服务时不注册任何工具', () => {
    expect(knowledgeTools({} as AgentDeps)).toEqual([])
  })
})
