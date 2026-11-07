import * as z from 'zod'

import type { AppReference } from '../../../../shared/app-reference'
import {
  KB_EMPTY_HINT,
  formatKbHitsForAgent,
  kbCategoryLabel
} from '../../../../shared/knowledge-base'
import type {
  KbDegradedReason,
  KbDocumentView,
  KbImportResult
} from '../../../../shared/knowledge-base'
import { validateKbCategory, validateKbDocumentId } from '../../../ipc/validation'
import type { ToolFactory } from './deps'

/** 返回给模型的检索结果：正文只放在 text 里，避免同一段内容重复两遍。 */
interface KbSearchPayload {
  text: string
  degraded: KbDegradedReason | null
  count: number
  dropped: number
  hits: Array<{
    documentId: string
    chunkId: string
    documentTitle: string
    heading: string
    ordinal: number
  }>
}

const searchSchema = z.object({
  query: z
    .string()
    .min(1)
    .max(200)
    .describe('检索词：用问题里的关键名词组合，不要整句照抄；两个以上关键词用空格分开'),
  category: z.string().max(20).optional().describe('只看某个类别时传类别 id：work / personal'),
  topK: z.number().int().min(1).max(20).optional().describe('期望命中段数，默认 8')
})

const importSchema = z.object({
  path: z.string().min(1).max(4096).describe('本机 .md / .txt 文件的绝对路径'),
  category: z.string().max(20).optional().describe('类别 id：work / personal，默认 work')
})

const removeSchema = z.object({
  documentId: z.string().min(1).max(64).describe('kb_list_documents 返回的资料 ID')
})

const listSchema = z.object({ category: z.string().max(20).optional() })

function documentReference(document: Pick<KbDocumentView, 'id' | 'title'>): AppReference {
  return {
    label: `知识库「${document.title}」`,
    target: { kind: 'kb', id: document.id }
  }
}

function searchReferences(payload: KbSearchPayload): AppReference[] {
  return payload.hits.slice(0, 4).map((hit) => ({
    label: `${hit.documentTitle}${hit.heading ? ` · ${hit.heading}` : ''}`,
    target: { kind: 'kb', id: hit.documentId, chunkId: hit.chunkId }
  }))
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/**
 * 知识库工具：让 Agent 自己判断是否需要查用户资料。
 *
 * 不做额外分类器：工具描述写明"涉及用户自己的资料时先查"，
 * 系统提示要求先列目录再检索；与本地资料无关的问题不应调用。
 */
export const knowledgeTools: ToolFactory = ({ knowledge }) => {
  if (!knowledge) return []
  return [
    {
      name: 'kb_search',
      description:
        '在用户的本地知识库（自己导入的 .md / .txt 资料）中检索。问题涉及用户的文档、规范、摘要、部署说明、个人资料时先调用；与本地资料无关的问题不要调用。返回带出处的片段，不返回整篇文档。',
      schema: searchSchema,
      risk: 'read',
      handler: async (input): Promise<KbSearchPayload> => {
        const data = searchSchema.parse(input)
        const result = await knowledge.search({
          query: data.query,
          category: data.category,
          topK: data.topK
        })
        return {
          text: formatKbHitsForAgent(result) ?? KB_EMPTY_HINT,
          degraded: result.degraded,
          count: result.hits.length,
          dropped: result.dropped,
          hits: result.hits.map((hit) => ({
            documentId: hit.documentId,
            chunkId: hit.chunkId,
            documentTitle: hit.documentTitle,
            heading: hit.heading,
            ordinal: hit.ordinal + 1
          }))
        }
      },
      references: (_input, result) => searchReferences(result as KbSearchPayload),
      summarize: (_input, result) => {
        const payload = result as KbSearchPayload
        return payload.count > 0 ? `检索到 ${payload.count} 段资料` : '没有找到匹配片段'
      }
    },
    {
      name: 'kb_list_documents',
      description:
        '列出用户知识库里的资料（标题、类别、块数、状态）。回答资料相关问题前先看一眼有没有相关文档；也是获取资料 ID 的唯一途径。',
      schema: listSchema,
      risk: 'read',
      handler: async (input) => {
        const data = listSchema.parse(input)
        const documents = await knowledge.list({ category: data.category })
        return {
          total: documents.length,
          documents: documents.map((document) => ({
            id: document.id,
            title: document.title,
            category: document.category,
            categoryLabel: kbCategoryLabel(document.category),
            chunkCount: document.chunkCount,
            status: document.status,
            fileSize: formatSize(document.fileSize),
            updatedAt: new Date(document.updatedAtMs).toLocaleString('sv-SE')
          }))
        }
      },
      references: (_input, result) =>
        (result as { documents: Array<{ id: string; title: string }> }).documents
          .slice(0, 6)
          .map(documentReference),
      summarize: (_input, result) => {
        const total = (result as { total: number }).total
        return total > 0 ? `共 ${total} 篇资料` : '知识库还是空的'
      }
    },
    {
      name: 'kb_add_document',
      description:
        '把一个本机 .md / .txt 文件导入知识库。只在用户明确要求导入资料时使用；路径必须绝对且已向用户确认。导入完成后即可被 kb_search 检索。',
      schema: importSchema,
      risk: 'write',
      prepare: async (input) => {
        const data = importSchema.parse(input)
        const info = await knowledge.inspectPath(data.path)
        const category = validateKbCategory(data.category) ?? 'work'
        // 配了向量模型就会把分块正文发给 /embeddings，审批卡必须如实说明。
        const embedding = await knowledge.embeddingConfigured()
        const privacy = embedding
          ? '已配置向量模型：导入时会把分块正文发送给当前 AI 服务的 /embeddings 接口用于生成向量。'
          : '文件内容只在本机解析，不发送到网络。'
        return {
          args: `导入资料：${info.name}\n路径：${info.path}\n大小：${formatSize(info.size)}\n类别：${kbCategoryLabel(category)}\n\n${privacy}`,
          // 会把正文发给外部向量接口时，即使“完全访问”也要求一次明确同意。
          requireApproval: embedding,
          execute: async () => knowledge.importPaths([info.path], { category })
        }
      },
      handler: async (input) => {
        const data = importSchema.parse(input)
        const category = validateKbCategory(data.category) ?? 'work'
        return knowledge.importPaths([data.path], { category })
      },
      references: (_input, result) => (result as KbImportResult).imported.map(documentReference),
      summarize: (_input, result) => {
        const { imported, skipped } = result as KbImportResult
        if (imported.length > 0) {
          const document = imported[0]
          return document.status === 'failed'
            ? `导入失败：${document.error}`
            : `已导入「${document.title}」，共 ${document.chunkCount} 段`
        }
        return skipped[0]?.reason ?? '未导入'
      }
    },
    {
      name: 'kb_remove_document',
      description:
        '从知识库删除一篇资料及其全部分块；不改动源文件。只在用户明确要求删除时使用，调用前先用 kb_list_documents 核对标题。',
      schema: removeSchema,
      risk: 'destructive',
      prepare: async (input) => {
        const data = removeSchema.parse(input)
        const documentId = validateKbDocumentId(data.documentId)
        const detail = await knowledge.detail(documentId)
        return {
          args: `删除资料「${detail.document.title}」\n块数：${detail.document.chunkCount}\n源文件：${detail.sourcePath}\n\n只删除知识库中的索引与分块，源文件不受影响。`,
          execute: async () => {
            knowledge.remove(documentId)
            return detail.document
          }
        }
      },
      handler: async (input) => {
        const data = removeSchema.parse(input)
        const documentId = validateKbDocumentId(data.documentId)
        const detail = await knowledge.detail(documentId)
        knowledge.remove(documentId)
        return detail.document
      },
      summarize: (_input, result) => `已删除资料「${(result as KbDocumentView).title}」`
    }
  ]
}
