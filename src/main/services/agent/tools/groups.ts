import * as z from 'zod'

import type { ToolFactory } from './deps'
import { resolveGroup } from './resolve'

export const groupTools: ToolFactory = ({ store }) => [
  {
    name: 'groups_list',
    description: '列出书架的全部分组。',
    schema: z.object({}),
    risk: 'read',
    summarize: (_input, result) => `共 ${(result as unknown[]).length} 个分组`,
    handler: async () => store.listGroups().map((group) => ({ id: group.id, name: group.name }))
  },
  {
    name: 'groups_create',
    description: '新建一个书架分组。',
    schema: z.object({
      name: z.string().max(20).describe('分组名称')
    }),
    risk: 'write',
    summarize: (_input, result) => `已新建分组「${(result as { name: string }).name}」`,
    handler: async (input) => {
      const group = store.createGroup(String(input.name ?? ''))
      return { id: group.id, name: group.name }
    }
  },
  {
    name: 'groups_rename',
    description: '重命名一个分组。',
    schema: z.object({
      group: z.string().max(40).describe('分组名称或 ID'),
      name: z.string().max(20).describe('新名称')
    }),
    risk: 'write',
    summarize: (_input, result) => `已重命名为「${(result as { name: string }).name}」`,
    handler: async (input) => {
      const group = resolveGroup(store, String(input.group ?? ''))
      store.renameGroup(group.id, String(input.name ?? ''))
      return { id: group.id, name: String(input.name ?? '').trim() }
    }
  },
  {
    name: 'groups_delete',
    description: '删除一个分组；组内小说会被移出分组（不会被删除）。',
    schema: z.object({
      group: z.string().max(40).describe('分组名称或 ID')
    }),
    risk: 'destructive',
    summarize: (_input, result) => `已删除分组「${(result as { deleted: string }).deleted}」`,
    handler: async (input) => {
      const group = resolveGroup(store, String(input.group ?? ''))
      store.deleteGroup(group.id)
      return { deleted: group.name }
    }
  }
]
