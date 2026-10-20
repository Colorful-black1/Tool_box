import { optionalText, requireText, textParam } from '../tool-registry'
import type { ToolFactory } from './deps'
import { resolvePassword } from './resolve'

/**
 * 账号脱敏：密码箱明文绝不进入模型上下文。
 * 只回「账号首字符 + 掩码」用于让用户辨认条目，密码本身只回是否存在。
 *
 * 与桌面端 `tools/passwords.ts` 的 `maskAccount` 完全一致 ——
 * 这是安全边界，两端措辞不要各自演进。
 */
function maskAccount(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ''
  if (trimmed.length <= 2) return '*'.repeat(trimmed.length)
  return `${trimmed[0]}${'*'.repeat(Math.min(trimmed.length - 1, 6))}`
}

/**
 * 手机端密码箱：**不给「保存 / 覆盖」，只给收藏与删除**。
 *
 * 桌面端还有 `passwords_save`，手机端刻意不给：`isDecryptable === false`
 * 的条目一旦被覆盖保存，原始密文会被占位文本永久替换（见 docs/ROADMAP.md 第 3 节）。
 *
 * 但 `passwords_set_favorite` 与 `passwords_delete` 是安全的 ——
 * 前者只 `UPDATE is_favorite` 一列，后者只删行，**都不经过加解密**，
 * 因此不会破坏任何条目的原始密文。这两个工具在桌面端同名同义。
 */
export const passwordTools: ToolFactory = ({ store }) => [
  {
    name: 'passwords_list',
    description:
      '列出密码箱条目（账号已脱敏、不含明文密码），可按名称或网址关键词过滤。用于让用户确认要查看哪一条。',
    parameters: {
      type: 'object',
      properties: { query: textParam('名称或网址关键词，留空返回全部', 60) }
    },
    risk: 'read',
    summarize: (_input, result) => `共 ${(result as unknown[]).length} 条密码记录`,
    handler: async (input) => {
      const query = (optionalText(input, 'query', '关键词', 60) ?? '').toLowerCase()
      const entries = await store.listPasswords()
      return entries
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
    name: 'passwords_set_favorite',
    description: '把某条密码箱记录设为 / 取消收藏。不会改动密码本身。',
    parameters: {
      type: 'object',
      properties: {
        entry: textParam('条目名称或 ID', 120),
        favorite: { type: 'boolean', description: 'true 收藏，false 取消收藏' }
      },
      required: ['entry', 'favorite']
    },
    risk: 'write',
    summarize: (_input, result) => {
      const data = result as { title: string; isFavorite: boolean }
      return `已${data.isFavorite ? '收藏' : '取消收藏'}「${data.title}」`
    },
    handler: async (input) => {
      const entry = await resolvePassword(
        store,
        requireText(input, 'entry', '条目名称或 ID', 120)
      )
      const favorite = input['favorite'] === true
      await store.setPasswordFavorite(entry.id, favorite)
      return { title: entry.title, isFavorite: favorite }
    }
  },
  {
    name: 'passwords_delete',
    description: '删除一条密码箱记录。此操作不可撤销。',
    parameters: {
      type: 'object',
      properties: { entry: textParam('条目名称或 ID', 120) },
      required: ['entry']
    },
    risk: 'destructive',
    summarize: (_input, result) =>
      `已删除密码条目「${(result as { deleted: string }).deleted}」`,
    handler: async (input) => {
      const entry = await resolvePassword(
        store,
        requireText(input, 'entry', '条目名称或 ID', 120)
      )
      await store.deletePassword(entry.id)
      return { deleted: entry.title }
    }
  }
]
