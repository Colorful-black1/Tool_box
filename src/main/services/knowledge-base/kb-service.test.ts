import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { KbProgressEvent } from '../../../shared/knowledge-base'
import { ToolboxStore } from '../chat-store/chat-store'
import type { SecretBox } from '../crypto/secret-box'
import { KnowledgeBaseService } from './kb-service'

const box: SecretBox = {
  encrypt: (value) => JSON.stringify(value),
  decrypt: (value) => JSON.parse(value)
}

let root = ''
let store: ToolboxStore
let service: KnowledgeBaseService

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'toolbox-kb-'))
  store = new ToolboxStore(join(root, 'toolbox.db'), box)
  service = new KnowledgeBaseService(store)
})

afterEach(async () => {
  store.close()
  await rm(root, { recursive: true, force: true })
})

async function writeDocument(name: string, content: string): Promise<string> {
  const path = join(root, name)
  await writeFile(path, content, 'utf8')
  return path
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  })
}

const embeddingConfig = {
  provider: 'custom' as const,
  baseUrl: 'https://api.example.com/v1',
  apiKey: 'sk-test',
  model: 'bge-m3'
}

function embeddingSettings(): {
  getEmbeddingConfig(): Promise<typeof embeddingConfig>
  getRerankConfig(): Promise<null>
} {
  return {
    getEmbeddingConfig: async () => embeddingConfig,
    getRerankConfig: async () => null
  }
}

function embeddingFetch(): typeof fetch {
  return vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { input: string[] }
    return jsonResponse({
      data: body.input.map((text, index) => ({
        index,
        embedding: text.includes('备份') || text.includes('恢复') ? [1, 0] : [0, 1]
      }))
    })
  }) as unknown as typeof fetch
}

describe('本地知识库', () => {
  it('导入 Markdown 后可被两字关键词检索，并带章节面包屑', async () => {
    const path = await writeDocument(
      '部署.md',
      '# 部署\n\n## 回滚\n\n数据库回滚要先恢复备份，再检查网关。\n\n## 发布\n\n发布前确认灰度比例。'
    )

    const result = await service.importPaths([path], { category: 'work' })
    expect(result.imported).toHaveLength(1)
    expect(result.imported[0]).toMatchObject({
      title: '部署',
      status: 'ready',
      chunkCount: 2,
      fileName: '部署.md'
    })
    expect(result.skipped).toEqual([])

    const found = await service.search({ query: '回滚' })
    expect(found.hits).toHaveLength(1)
    expect(found.hits[0]).toMatchObject({
      documentTitle: '部署',
      heading: '部署 > 回滚',
      ordinal: 0
    })
    expect(found.hits[0].content).toContain('恢复备份')
    expect(found.degraded).toBe('no-embedding')
    expect((await service.search({ query: '回滚', mode: 'keyword' })).degraded).toBeNull()
  })

  it('相同内容重复导入会被跳过，不产生重复文档', async () => {
    const first = await writeDocument('a.md', '# 甲\n\n同一份内容。')
    const second = await writeDocument('b.md', '# 甲\n\n同一份内容。')
    await service.importPaths([first])

    const again = await service.importPaths([first])
    expect(again.imported).toEqual([])
    expect(again.skipped[0].reason).toContain('已导入')

    const duplicated = await service.importPaths([second])
    expect(duplicated.imported).toEqual([])
    expect(await service.list()).toHaveLength(1)
  })

  it('类别筛选只返回对应类别', async () => {
    const work = await writeDocument('工作.md', '# 工作\n\n部署清单。')
    const personal = await writeDocument('个人.md', '# 个人\n\n旅行清单。')
    await service.importPaths([work], { category: 'work' })
    await service.importPaths([personal], { category: 'personal' })

    expect((await service.search({ query: '清单', category: 'work' })).hits).toHaveLength(1)
    expect((await service.search({ query: '清单', category: 'personal' })).hits).toHaveLength(1)
    expect((await service.search({ query: '清单', category: 'work' })).hits[0].documentTitle).toBe(
      '工作'
    )
  })

  it('单字中文查询走 LIKE 兜底', async () => {
    const path = await writeDocument('日志.md', '# 日志\n\n下雨天记得带伞。')
    await service.importPaths([path])

    const found = await service.search({ query: '雨' })
    expect(found.hits).toHaveLength(1)
    expect(found.hits[0].content).toContain('下雨')
  })

  it('拒绝相对路径、非白名单扩展名与不存在的文件', async () => {
    const relative = await service.importPaths(['docs/不存在.md'])
    expect(relative.imported).toEqual([])
    expect(relative.skipped[0].reason).toContain('绝对路径')

    const pdf = await writeDocument('手册.pdf', '%PDF-1.4')
    const rejected = await service.importPaths([pdf])
    expect(rejected.imported).toEqual([])
    expect(rejected.skipped[0].reason).toContain('.md / .txt')

    const missing = await service.importPaths([join(root, '没有这个.md')])
    expect(missing.skipped[0].reason).toContain('不存在')
  })

  it('空文档给出可读原因，不写入半成品', async () => {
    const path = await writeDocument('空白.md', '   \n\n  ')
    const result = await service.importPaths([path])
    expect(result.imported).toEqual([])
    expect(result.skipped[0].reason).toContain('没有可索引')
    expect(await service.list()).toEqual([])
  })

  it('导入成功后推读、切块、索引、完成四个进度', async () => {
    const path = await writeDocument('进度.md', '# 进度\n\n只是测试。')
    const events: KbProgressEvent[] = []
    await service.importPaths([path], { onProgress: (event) => events.push(event) })

    expect(events.map((event) => event.phase)).toEqual([
      'reading',
      'chunking',
      'indexing',
      'ready'
    ])
    expect(events.at(-1)).toMatchObject({ done: 1, total: 1, title: '进度' })
  })

  it('重建会按新内容更新分块，删除后检索不再命中', async () => {
    const path = await writeDocument('变更.md', '# 变更\n\n旧内容：部署网关。')
    const imported = await service.importPaths([path])
    const documentId = imported.imported[0].id

    await writeFile(path, '# 变更\n\n新内容：回滚数据库。', 'utf8')
    const updated = await service.reindex(documentId)
    expect(updated.status).toBe('ready')
    expect((await service.search({ query: '回滚' })).hits).toHaveLength(1)
    expect((await service.search({ query: '网关' })).hits).toHaveLength(0)

    service.remove(documentId)
    expect(await service.list()).toEqual([])
    expect((await service.search({ query: '回滚' })).hits).toEqual([])
    await expect(service.detail(documentId)).rejects.toThrow('资料不存在')
  })

  it('详情返回分块预览并只定位属于该文档的分块', async () => {
    const path = await writeDocument('详情.md', '# 详情\n\n第一段。\n\n第二段。')
    const imported = await service.importPaths([path])
    const documentId = imported.imported[0].id

    const detail = await service.detail(documentId)
    expect(detail.sourcePath).toBe(path)
    expect(detail.chunks).toHaveLength(1)
    expect(detail.focusChunkId).toBeNull()

    const chunkId = detail.chunks[0].id
    expect((await service.detail(documentId, chunkId)).focusChunkId).toBe(chunkId)
    expect((await service.detail(documentId, 'not-a-chunk')).focusChunkId).toBeNull()
  })

  it('配置向量模型后导入即生成向量，检索走关键词 + 语义融合', async () => {
    const path = await writeDocument(
      '语义.md',
      '# 语义\n\n## 恢复\n\n数据库回滚要先恢复备份。\n\n## 发布\n\n发布前检查灰度。'
    )
    const semantic = new KnowledgeBaseService(store, embeddingSettings(), embeddingFetch())

    const imported = await semantic.importPaths([path])
    expect(imported.imported[0]).toMatchObject({ status: 'ready', error: '' })
    expect(imported.imported[0].chunkCount).toBe(2)
    expect(imported.imported[0].embeddedChunkCount).toBe(2)

    const result = await semantic.search({ query: '恢复' })
    expect(result.degraded).toBeNull()
    expect(result.mode).toBe('hybrid')
    expect(result.semanticCount).toBe(1)
    expect(result.keywordCount).toBe(1)
    expect(result.hits[0].content).toContain('恢复备份')
  })

  it('配了向量模型但资料尚未向量化时退回关键词并说明原因', async () => {
    const path = await writeDocument('未向量.md', '# 未向量\n\n部署网关与回滚。')
    await service.importPaths([path])

    const semantic = new KnowledgeBaseService(store, embeddingSettings(), embeddingFetch())
    const result = await semantic.search({ query: '回滚' })
    expect(result.degraded).toBe('no-vectors')
    expect(result.message).toContain('补齐向量')
    expect(result.hits.length).toBeGreaterThan(0)
  })

  it('向量接口失败时关键词仍可用，并保留可读提示', async () => {
    const path = await writeDocument('失败.md', '# 失败\n\n部署网关与回滚。')
    const failing = vi.fn(async () => jsonResponse({ error: 'boom' }, 500)) as unknown as typeof fetch
    const semantic = new KnowledgeBaseService(store, embeddingSettings(), failing)

    const imported = await semantic.importPaths([path])
    expect(imported.imported[0].status).toBe('ready')
    expect(imported.imported[0].error).toContain('关键词检索仍可用')
    expect(imported.imported[0].embeddedChunkCount).toBe(0)

    const result = await semantic.search({ query: '回滚' })
    expect(result.degraded).toBe('embedding-failed')
    expect(result.hits.length).toBeGreaterThan(0)
  })

  it('配置重排模型后按重排分数调整顺序，失败时保持融合排序', async () => {
    const first = await writeDocument('重排甲.md', '# 甲\n\n部署网关。')
    const second = await writeDocument('重排乙.md', '# 乙\n\n部署网关与回滚。')
    await service.importPaths([first])
    await service.importPaths([second])
    const baseline = await service.search({ query: '部署' })
    expect(baseline.hits).toHaveLength(2)

    const models = {
      getEmbeddingConfig: async () => null,
      getRerankConfig: async () => ({
        provider: 'custom' as const,
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'sk-test',
        model: 'bge-reranker-v2-m3'
      })
    }
    const rerankFetch = vi.fn(async () =>
      jsonResponse({
        results: [
          { index: 0, relevance_score: 0.1 },
          { index: 1, relevance_score: 0.9 }
        ]
      })
    ) as unknown as typeof fetch
    const rerankedService = new KnowledgeBaseService(store, models, rerankFetch)

    const reranked = await rerankedService.search({ query: '部署' })
    expect(reranked.rerank).toBe('applied')
    expect(reranked.hits.map((hit) => hit.chunkId)).toEqual(
      baseline.hits.map((hit) => hit.chunkId).reverse()
    )

    const failingFetch = vi.fn(async () => jsonResponse({}, 500)) as unknown as typeof fetch
    const failedService = new KnowledgeBaseService(store, models, failingFetch)
    const failed = await failedService.search({ query: '部署' })
    expect(failed.rerank).toBe('failed')
    expect(failed.message).toContain('重排')
    expect(failed.hits.map((hit) => hit.chunkId)).toEqual(
      baseline.hits.map((hit) => hit.chunkId)
    )
  })

  it('换向量模型后覆盖率归零，重建后恢复', async () => {
    const path = await writeDocument('换模型.md', '# 换模型\n\n部署网关与回滚。')
    const first = new KnowledgeBaseService(store, embeddingSettings(), embeddingFetch())
    const imported = await first.importPaths([path])
    expect((await first.list())[0].embeddedChunkCount).toBe(1)

    const secondModels = {
      getEmbeddingConfig: async () => ({ ...embeddingConfig, model: 'another-embed' }),
      getRerankConfig: async () => null
    }
    const second = new KnowledgeBaseService(store, secondModels, embeddingFetch())
    expect((await second.list())[0].embeddedChunkCount).toBe(0)
    expect((await second.search({ query: '回滚' })).degraded).toBe('no-vectors')

    await second.reindex(imported.imported[0].id)
    expect((await second.list())[0].embeddedChunkCount).toBe(1)
    expect((await second.search({ query: '回滚' })).degraded).toBeNull()
  })

  it('知识库表结构与 user_version 升到 v6', () => {
    const database = new Database(join(root, 'toolbox.db'), { readonly: true })
    try {
      expect(database.pragma('user_version', { simple: true })).toBe(6)
      expect(
        database
          .prepare("SELECT name FROM sqlite_master WHERE name = 'kb_chunks_fts'")
          .get()
      ).toBeTruthy()
    } finally {
      database.close()
    }
  })
})
