import { optionalText, textParam } from '../tool-registry'
import type { ToolFactory } from './deps'

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
 * 手机端密码箱**只读**（M6 的刻意取舍）。
 *
 * 桌面端有 `passwords_save` / `passwords_set_favorite` / `passwords_delete`，
 * 手机端一个都不给：`isDecryptable === false` 的条目一旦被覆盖保存，
 * 原始密文会被占位文本永久替换（见 docs/ROADMAP.md 第 3 节）。
 * AI 驱动的写操作更容易在用户没看清条目状态时触发，因此先不开这个口子。
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
  }
]
