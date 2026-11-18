import * as z from 'zod'

import { MEMORY_KINDS, MEMORY_LIMITS, MEMORY_STATUSES } from '../../../../shared/types'
import type { MemoryItemView, MemoryKind } from '../../../../shared/types'
import type { ToolFactory } from './deps'
import type { PreparedAgentTool } from '../tool-registry'

const rememberSchema = z.object({
  kind: z
    .enum(MEMORY_KINDS)
    .optional()
    .describe(
      'preference 偏好、profile 用户事实、constraint 约束、procedural 流程；不确定用 preference'
    ),
  title: z.string().min(1).max(MEMORY_LIMITS.title).describe('一句短标题，例如「回答先给结论」'),
  body: z
    .string()
    .min(1)
    .max(MEMORY_LIMITS.body)
    .describe('完整、可独立理解的一条信息；不要保存密码、API Key 或一次性任务状态'),
  tags: z
    .array(z.string().max(MEMORY_LIMITS.tag))
    .max(MEMORY_LIMITS.tags)
    .optional()
    .describe('可选标签，例如「回答风格」「发布流程」')
})

const MEMORY_KIND_FILTERS = [...MEMORY_KINDS, 'all'] as const
const MEMORY_STATUS_FILTERS = [...MEMORY_STATUSES, 'all'] as const

const listSchema = z.object({
  query: z.string().max(120).optional().describe('按标题或正文关键词过滤'),
  kind: z.enum(MEMORY_KIND_FILTERS).optional(),
  status: z.enum(MEMORY_STATUS_FILTERS).optional()
})

const searchSchema = z.object({
  query: z.string().min(1).max(200).describe('检索词：用当前问题里的关键名词组合，不要整句照抄'),
  kind: z.enum(MEMORY_KIND_FILTERS).optional(),
  tags: z.string().max(MEMORY_LIMITS.tag).optional().describe('只看某个标签'),
  limit: z.number().int().min(1).max(10).optional().describe('返回条数，默认 5')
})

const readSchema = z.object({
  id: z.string().max(64).describe('memory_search / memory_list 返回的记忆 ID')
})

const forgetSchema = z.object({
  id: z.string().max(64).describe('memory_list 返回的记忆 ID')
})

/** 返回给模型的最小字段集：不暴露来源会话正文与内部时间戳。 */
function agentView(item: MemoryItemView): Record<string, unknown> {
  return {
    id: item.id,
    kind: item.kind,
    title: item.title,
    body: item.body,
    tags: item.tags,
    pinned: item.pinned,
    status: item.status
  }
}

/** 检索结果只给摘要，完整正文由 memory_read 按需读取。 */
function searchView(item: MemoryItemView): Record<string, unknown> {
  return {
    id: item.id,
    kind: item.kind,
    title: item.title,
    body: item.body.length > 240 ? `${item.body.slice(0, 240)}…` : item.body,
    tags: item.tags,
    confidence: item.confidence,
    updatedAtMs: item.updatedAtMs
  }
}

export const memoryTools: ToolFactory = ({ memory }) => {
  if (!memory || !memory.isEnabled()) return []

  return [
    {
      name: 'memory_list',
      description:
        '查看用户已确认的长期记忆（偏好、画像、约束、流程）。用户问「你记得什么」或需要核对已有偏好时调用；返回 ID 供 memory_forget 使用。',
      schema: listSchema,
      risk: 'read',
      handler: async (input) => {
        const data = listSchema.parse(input)
        const result = memory.list({
          query: data.query,
          kind: (data.kind ?? 'all') as MemoryKind | 'all',
          status: data.status ?? 'active',
          limit: MEMORY_LIMITS.listLimit
        })
        return {
          count: result.total,
          items: result.items.map(agentView)
        }
      },
      summarize: (_input, result) => {
        const count = (result as { count: number }).count
        return count > 0 ? `读取到 ${count} 条长期记忆` : '没有匹配的长期记忆'
      }
    },
    {
      name: 'memory_search',
      description:
        '在用户已确认的长期记忆中检索。用户问「你记得…」「我之前说过…」或完成任务需要核对偏好 / 约束时调用；只返回摘要与 ID，完整正文用 memory_read。',
      schema: searchSchema,
      risk: 'read',
      handler: async (input) => {
        const data = searchSchema.parse(input)
        const items = memory.search({
          query: data.query,
          kind: (data.kind ?? 'all') as MemoryKind | 'all',
          ...(data.tags ? { tags: data.tags } : {}),
          limit: data.limit ?? 5
        })
        return { count: items.length, items: items.map(searchView) }
      },
      summarize: (_input, result) => {
        const count = (result as { count: number }).count
        return count > 0 ? `检索到 ${count} 条相关记忆` : '没有找到相关记忆'
      }
    },
    {
      name: 'memory_read',
      description:
        '按 memory_search / memory_list 得到的确切 ID 读取一条长期记忆的完整正文与来源摘录；不要凭标题猜 ID。',
      schema: readSchema,
      risk: 'read',
      handler: async (input) => {
        const data = readSchema.parse(input)
        const item = memory.get(data.id)
        return {
          ...agentView(item),
          confidence: item.confidence,
          updatedAtMs: item.updatedAtMs,
          source: {
            conversationId: item.sourceConversationId,
            messageId: item.sourceMessageId,
            excerpt: item.sourceExcerpt
          }
        }
      },
      summarize: (_input, result) => `读取记忆「${(result as { title: string }).title}」`
    },
    {
      name: 'memory_remember',
      description:
        '用户明确说「记住」「以后都」「不要再」时，保存一条长期记忆。写入前会请用户确认；不要凭猜测调用，也不要保存密码、API Key 或临时任务状态。',
      schema: rememberSchema,
      risk: 'write',
      prepare: async (input, ctx): Promise<PreparedAgentTool> => {
        const data = rememberSchema.parse(input)
        const draft = memory.normalize({
          kind: data.kind ?? 'preference',
          title: data.title,
          body: data.body,
          tags: data.tags ?? [],
          pinned: false
        })
        const labels: Record<string, string> = {
          preference: '偏好',
          profile: '画像',
          constraint: '约束',
          procedural: '流程',
          episodic: '事件'
        }
        return {
          args: `记住一条${labels[draft.kind]}记忆：\n标题：${draft.title}\n内容：${draft.body}${draft.tags.length ? `\n标签：${draft.tags.join('、')}` : ''}`,
          execute: async () =>
            agentView(
              memory.save(
                {
                  kind: draft.kind,
                  title: draft.title,
                  body: draft.body,
                  tags: draft.tags,
                  pinned: draft.pinned
                },
                {
                  ...(ctx.conversationId ? { conversationId: ctx.conversationId } : {}),
                  ...(ctx.sourceMessageId ? { messageId: ctx.sourceMessageId } : {}),
                  excerpt: draft.body.slice(0, MEMORY_LIMITS.excerpt)
                }
              )
            )
        }
      },
      handler: async () => {
        throw new Error('请通过审批入口保存记忆')
      },
      summarize: (_input, result) => `已记住「${(result as { title: string }).title}」`
    },
    {
      name: 'memory_forget',
      description:
        '用户明确要求忘记某条长期记忆时，按 memory_list 得到的确切 ID 归档；不物理删除，用户可在设置页恢复或彻底删除。',
      schema: forgetSchema,
      risk: 'write',
      prepare: async (input): Promise<PreparedAgentTool> => {
        const data = forgetSchema.parse(input)
        const before = memory.get(data.id)
        if (before.status === 'archived') throw new Error('这条记忆已经归档，无需重复操作')
        return {
          args: `归档长期记忆「${before.title}」\n内容：${before.body}`,
          execute: async () => agentView(memory.setState({ id: before.id, status: 'archived' }))
        }
      },
      handler: async () => {
        throw new Error('请通过审批入口归档记忆')
      },
      summarize: (_input, result) => `已归档「${(result as { title: string }).title}」`
    }
  ]
}
