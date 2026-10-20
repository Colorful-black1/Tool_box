import type { ToolFactory } from './deps'

/**
 * 书架分组（只读）。
 *
 * 桌面端还有 `groups_create` / `groups_rename` / `groups_delete`，
 * 手机端暂只给「列出」：分组改名 / 删除属于结构调整，
 * 由书架页面的分组管理入口负责（那里有二次确认与候选提示）。
 */
export const groupTools: ToolFactory = ({ store }) => [
  {
    name: 'groups_list',
    description: '列出书架的全部分组。',
    parameters: { type: 'object', properties: {} },
    risk: 'read',
    summarize: (_input, result) => `共 ${(result as unknown[]).length} 个分组`,
    handler: async () => {
      const groups = await store.listGroups()
      return groups.map((group) => ({ id: group.id, name: group.name }))
    }
  }
]
