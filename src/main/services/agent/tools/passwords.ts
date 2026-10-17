import * as z from 'zod'

import type { ToolFactory } from './deps'
import { resolvePassword } from './resolve'

/**
 * 账号脱敏：密码箱明文绝不进入模型上下文。
 * 只回「账号首字符 + 掩码」用于让用户辨认条目，密码本身只回是否存在。
 */
function maskAccount(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ''
  if (trimmed.length <= 2) return '*'.repeat(trimmed.length)
  return `${trimmed[0]}${'*'.repeat(Math.min(trimmed.length - 1, 6))}`
}

export const passwordTools: ToolFactory = ({ store }) => [
  {
    name: 'passwords_list',
    description:
      '列出密码箱条目（账号已脱敏、不含明文密码），可按名称或网址关键词过滤。用于让用户确认要管理哪一条。',
    schema: z.object({
      query: z.string().max(60).optional().describe('名称或网址关键词，留空返回全部')
    }),
    risk: 'read',
    summarize: (_input, result) => `共 ${(result as unknown[]).length} 条密码记录`,
    handler: async (input) => {
      const query = String(input.query ?? '').trim().toLowerCase()
      return store
        .listPasswords()
        .filter(
          (entry) =>
            !query ||
            entry.title.toLowerCase().includes(query) ||
            entry.url.toLowerCase().includes(query)
        )
        .map((entry) => ({
          id: entry.id,
          title: entry.title,
          url: entry.url,
          account: maskAccount(entry.account),
          hasAccount: entry.account.trim().length > 0,
          hasPassword: entry.isDecryptable && entry.password.length > 0,
          isFavorite: entry.isFavorite,
          isDecryptable: entry.isDecryptable
        }))
    }
  },
  {
    name: 'passwords_save',
    description: '新建一条密码箱记录（或按 ID 覆盖更新）。密码会加密落库。',
    schema: z.object({
      title: z.string().max(60).describe('名称'),
      account: z.string().max(200).optional().describe('账号'),
      password: z.string().max(200).optional().describe('密码'),
      url: z.string().max(300).optional().describe('网址'),
      remark: z.string().max(500).optional().describe('备注')
    }),
    risk: 'write',
    summarize: (_input, result) => `已保存密码条目「${(result as { saved: string }).saved}」`,
    handler: async (input) => {
      const title = String(input.title ?? '')
      store.savePassword({
        title,
        account: typeof input.account === 'string' ? input.account : '',
        password: typeof input.password === 'string' ? input.password : '',
        url: typeof input.url === 'string' ? input.url : '',
        remark: typeof input.remark === 'string' ? input.remark : ''
      })
      return { saved: title }
    }
  },
  {
    name: 'passwords_set_favorite',
    description: '把某条密码箱记录设为 / 取消收藏。',
    schema: z.object({
      entry: z.string().max(120).describe('条目名称或 ID'),
      favorite: z.boolean().describe('true 收藏，false 取消收藏')
    }),
    risk: 'write',
    summarize: (_input, result) => {
      const data = result as { title: string; isFavorite: boolean }
      return `已${data.isFavorite ? '收藏' : '取消收藏'}「${data.title}」`
    },
    handler: async (input) => {
      const entry = resolvePassword(store, String(input.entry ?? ''))
      const favorite = input.favorite === true
      store.setPasswordFavorite(entry.id, favorite)
      return { title: entry.title, isFavorite: favorite }
    }
  },
  {
    name: 'passwords_delete',
    description: '删除一条密码箱记录。此操作不可撤销。',
    schema: z.object({
      entry: z.string().max(120).describe('条目名称或 ID')
    }),
    risk: 'destructive',
    summarize: (_input, result) =>
      `已删除密码条目「${(result as { deleted: string }).deleted}」`,
    handler: async (input) => {
      const entry = resolvePassword(store, String(input.entry ?? ''))
      store.deletePassword(entry.id)
      return { deleted: entry.title }
    }
  }
]
