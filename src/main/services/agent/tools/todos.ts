import * as z from 'zod'
import { parseDateTime } from '../../../../shared/dev-tools'
import type { AppReference } from '../../../../shared/app-reference'
import type { TodoInput, TodoView } from '../../../../shared/types'
import { requireString, validateTodoInput, validateTodoQuery } from '../../../ipc/validation'
import type { ToolFactory } from './deps'
import type { PreparedAgentTool } from '../tool-registry'

const saveSchema = z.object({
  id: z.string().max(64).optional().describe('更新时必须使用查询得到的确切 ID；不传则新建'),
  title: z.string().max(120).optional(),
  details: z.string().max(4000).optional(),
  priority: z.enum(['low', 'normal', 'high']).optional(),
  start: z
    .string()
    .max(19)
    .nullable()
    .optional()
    .describe('本机时间 YYYY-MM-DD HH:mm[:ss]；null 清除'),
  due: z
    .string()
    .max(19)
    .nullable()
    .optional()
    .describe('本机时间 YYYY-MM-DD HH:mm[:ss]；null 清除'),
  remind: z.boolean().optional()
})

function date(value: string | null | undefined, previous: number | null): number | null {
  if (value === undefined) return previous
  if (value === null) return null
  if (!/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/.test(value))
    throw new Error('请提供具体的本机日期和时间，格式为 YYYY-MM-DD HH:mm')
  const result = parseDateTime(value)
  if (result === null) throw new Error('日期时间无效或处于夏令时缺口，请重新确认')
  return result
}

function view(item: TodoView): TodoView & { startLocal: string | null; dueLocal: string | null } {
  const local = (value: number | null): string | null =>
    value === null ? null : new Date(value).toLocaleString('sv-SE')
  return { ...item, startLocal: local(item.startAtMs), dueLocal: local(item.dueAtMs) }
}

function reference(item: TodoView): AppReference[] {
  return [{ label: `待办「${item.title}」`, target: { kind: 'todo', id: item.id } }]
}

export const todoTools: ToolFactory = ({ todos }) => {
  if (!todos) return []
  const get = (id: unknown): TodoView => todos.get(requireString(id, '待办 ID', { maxLength: 64 }))
  const unchanged = (before: TodoView): void => {
    if (JSON.stringify(todos.get(before.id)) !== JSON.stringify(before))
      throw new Error('待办已被修改，请重新查询并核对后操作')
  }
  const prepareSave = async (input: Record<string, unknown>): Promise<PreparedAgentTool> => {
    const data = saveSchema.parse(input)
    const before = data.id ? get(data.id) : null
    const valid: TodoInput = validateTodoInput({
      id: before?.id,
      title: data.title ?? before?.title ?? '',
      details: data.details ?? before?.details ?? '',
      priority: data.priority ?? before?.priority ?? 'normal',
      startAtMs: date(data.start, before?.startAtMs ?? null),
      dueAtMs: date(data.due, before?.dueAtMs ?? null),
      remind: data.remind ?? before?.remind ?? true
    })
    const local = (ms: number | null): string =>
      ms === null ? '无' : new Date(ms).toLocaleString('sv-SE')
    const priority = { low: '低', normal: '普通', high: '高' }[valid.priority]
    return {
      args: `${before ? '修改' : '新建'}待办：${valid.title}\n备注：${valid.details}\n优先级：${priority}\n开始：${local(valid.startAtMs)}\n截止：${local(valid.dueAtMs)}\n提醒：${valid.remind ? '开启（应用运行或托盘驻留）' : '关闭'}`,
      execute: async () => {
        if (before) unchanged(before)
        return view(todos.save(valid))
      }
    }
  }
  return [
    {
      name: 'todos_list',
      description:
        '查询待办：all 为全部未完成；today 今日、upcoming 待开始、overdue 逾期、completed 已完成、archived 归档。返回确切 ID、日期、状态与分页。',
      schema: z.object({
        filter: z.enum(['all', 'today', 'upcoming', 'overdue', 'completed', 'archived']).optional(),
        search: z.string().max(120).optional(),
        offset: z.number().int().min(0).max(1000000).optional(),
        limit: z.number().int().min(1).max(30).optional()
      }),
      risk: 'read',
      handler: async (input) => {
        const query = validateTodoQuery({
          filter: 'all',
          search: '',
          offset: 0,
          limit: 10,
          ...input
        })
        const result = todos.list(query)
        return {
          ...result,
          items: result.items.map((item) => view({ ...item, details: item.details.slice(0, 240) })),
          offset: query.offset,
          truncated: query.offset + result.items.length < result.total,
          now: new Date().toLocaleString('sv-SE'),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
        }
      },
      references: (_input, result) => (result as { items: TodoView[] }).items.flatMap(reference)
    },
    {
      name: 'todos_get',
      description: '按确切 ID 读取一条待办完整备注与状态，包括已完成或归档事项。',
      schema: z.object({ id: z.string().max(64) }),
      risk: 'read',
      handler: async (input) => view(get(input.id)),
      references: (_input, result) => reference(result as TodoView)
    },
    {
      name: 'todos_save',
      description:
        '新建或修改待办及开始／截止提醒；未传字段保留原值，null 日期清除。修改前先查询 ID。提醒仅应用运行／托盘驻留时有效。',
      schema: saveSchema,
      risk: 'write',
      prepare: prepareSave,
      handler: async (input) => (await prepareSave(input)).execute(),
      summarize: (_input, result) => `已保存待办「${(result as TodoView).title}」`,
      references: (_input, result) => reference(result as TodoView)
    },
    {
      name: 'todos_set_state',
      description: '按查询得到的确切 ID 完成、重开、归档或恢复一条待办；不物理删除。',
      schema: z.object({
        id: z.string().max(64),
        action: z.enum(['complete', 'reopen', 'archive', 'restore'])
      }),
      risk: 'write',
      prepare: async (input) => {
        const before = get(input.id)
        const action = z.enum(['complete', 'reopen', 'archive', 'restore']).parse(input.action)
        const labels = { complete: '完成', reopen: '重开', archive: '归档', restore: '恢复' }
        return {
          args: `${labels[action]}待办「${before.title}」`,
          execute: async () => {
            unchanged(before)
            if (action === 'complete' || action === 'reopen')
              todos.complete(before.id, action === 'complete')
            else todos.archive(before.id, action === 'archive')
            return view(todos.get(before.id))
          }
        }
      },
      handler: async () => {
        throw new Error('请通过审批入口更新待办状态')
      },
      references: (_input, result) => reference(result as TodoView)
    }
  ]
}
