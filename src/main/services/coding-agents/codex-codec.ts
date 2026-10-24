import type { CodingAgentOption } from '../../../shared/coding-agents'
import { redactData } from '../../../shared/redaction-tools'
import type { NativeCodingSession } from './adapter'
import { CodingAgentError } from './adapter'
import { codexObject, codexText } from './codex-connection'

/** 只保留模型选择需要的公开字段，认证和原始目录响应不跨进程。 */
export interface CodexModel {
  id: string
  label: string
  default: boolean
  effort: string
  efforts: string[]
}

export function codexModels(value: unknown): CodexModel[] {
  const result = codexObject(value)
  if (!Array.isArray(result?.data)) throw new CodingAgentError('Codex 未返回有效的模型目录')
  return result.data.slice(0, 200).flatMap((raw) => {
    const item = codexObject(raw)
    const id = codexText(item?.model)
    if (!id || item?.hidden === true) return []
    const efforts = Array.isArray(item?.supportedReasoningEfforts)
      ? item.supportedReasoningEfforts
          .map((v) => codexText(codexObject(v)?.reasoningEffort, 40))
          .filter((v) => /^[a-z][a-z0-9_-]{0,39}$/.test(v))
      : []
    return [
      {
        id,
        label: codexText(item?.displayName) || id,
        default: item?.isDefault === true,
        effort: codexText(item?.defaultReasoningEffort, 20),
        efforts: [...new Set(efforts)]
      }
    ]
  })
}

/** 权限独立于角色与推理模式；只读也可能产生原生升级审批。 */
export function codexOptions(
  models: CodexModel[],
  selected?: string,
  effort?: string
): CodingAgentOption[] {
  const model =
    models.find((item) => item.id === selected) ?? models.find((item) => item.default) ?? models[0]
  const options: CodingAgentOption[] = [
    {
      id: 'permission',
      name: '操作权限',
      category: 'permission',
      currentValue: 'read-only',
      options: [
        { value: 'read-only', label: '只读 · 升级需审批' },
        { value: 'workspace-write', label: '项目写入 · 升级需审批' }
      ]
    }
  ]
  if (model)
    options.unshift({
      id: 'model',
      name: '模型',
      category: 'model',
      currentValue: selected || model.id,
      options: models.map((item) => ({ value: item.id, label: item.label }))
    })
  if (model?.efforts.length)
    options.push({
      id: 'effort',
      name: '推理深度',
      category: 'thought_level',
      currentValue:
        effort && model.efforts.includes(effort)
          ? effort
          : model.efforts.includes(model.effort)
            ? model.effort
            : model.efforts[0],
      options: model.efforts.map((value) => ({ value, label: value }))
    })
  return options
}

export function codexPreview(value: unknown): string {
  return redactData(codexText(value, 20_000)).output.slice(0, 4000)
}

export function codexTitle(thread: Record<string, unknown>): string {
  return codexText(thread.name, 100).trim() || codexText(thread.preview, 100).trim() || 'Codex 会话'
}

/** 按原生 item ID 合并增量和完成快照，避免同一回复显示两次。 */
export function codexMessage(
  session: NativeCodingSession,
  id: string,
  role: 'user' | 'assistant',
  content: string,
  append = false
): void {
  const existing = session.messages.find((item) => item.id === id)
  const next = (append ? (existing?.content ?? '') : '') + content
  const total =
    session.messages.reduce((sum, item) => sum + item.content.length, 0) -
    (existing?.content.length ?? 0) +
    next.length
  if (total > 200_000 || (!existing && session.messages.length >= 200))
    throw new CodingAgentError('会话内容达到显示上限，请停止任务后新建会话')
  if (existing) existing.content = next
  else session.messages.push({ id, role, content: next })
}

/** 只映射公开文本、工具摘要与原生父子关系；不输出 reasoning 或任意工具正文。 */
export function applyCodexItem(
  session: NativeCodingSession,
  raw: unknown,
  clientUserId?: string
): void {
  const item = codexObject(raw)
  const id = codexText(item?.id)
  if (!item || !id) return
  if (item.type === 'agentMessage')
    codexMessage(session, id, 'assistant', codexText(item.text, 200_000))
  else if (item.type === 'userMessage') {
    const text = Array.isArray(item.content)
      ? item.content
          .map((v) => {
            const part = codexObject(v)
            return part?.type === 'text' ? codexText(part.text, 50_000) : ''
          })
          .join('\n')
      : ''
    codexMessage(session, codexText(item.clientId) || clientUserId || id, 'user', text)
  } else if (item.type === 'collabAgentToolCall' && item.senderThreadId === session.id) {
    const states = codexObject(item.agentsStates)
    const receivers = Array.isArray(item.receiverThreadIds)
      ? item.receiverThreadIds.slice(0, 50)
      : []
    for (const rawId of receivers) {
      const childId = codexText(rawId)
      if (!childId) continue
      const state = codexObject(states?.[childId])
      subtask(
        session,
        childId,
        `原生子代理 · ${childId.slice(0, 8)}`,
        codexText(state?.status, 40) || 'unknown',
        codexPreview(state?.message)
      )
    }
  } else if (item.type === 'subAgentActivity') {
    const childId = codexText(item.agentThreadId)
    if (childId)
      subtask(
        session,
        childId,
        codexText(item.agentPath, 100) || `原生子代理 · ${childId.slice(0, 8)}`,
        codexText(item.kind, 40) || 'unknown',
        ''
      )
  } else {
    const names: Record<string, string> = {
      commandExecution: '执行命令',
      fileChange: '修改文件',
      mcpToolCall: 'MCP 工具',
      dynamicToolCall: '扩展工具',
      webSearch: '检索',
      imageView: '查看图片',
      collabAgentToolCall: '原生代理协作'
    }
    if (!Object.hasOwn(names, String(item.type))) return
    const title = `${names[String(item.type)]}${item.type === 'commandExecution' ? `：${codexPreview(item.command).slice(0, 400)}` : ''}`
    const rawStatus = codexText(item.status, 40)
    const status =
      rawStatus === 'inProgress'
        ? 'in_progress'
        : rawStatus === 'declined'
          ? 'failed'
          : rawStatus || 'completed'
    const existing = session.tools.find((tool) => tool.id === id)
    if (existing) Object.assign(existing, { title, status })
    else {
      if (session.tools.length >= 100) session.tools.shift()
      session.tools.push({ id, title, status })
    }
  }
}

function subtask(
  session: NativeCodingSession,
  id: string,
  title: string,
  status: string,
  result: string
): void {
  session.subtasks ??= []
  const existing = session.subtasks.find((item) => item.id === id)
  if (existing) Object.assign(existing, { title, status, result: result || existing.result })
  else if (session.subtasks.length < 50) session.subtasks.push({ id, title, status, result })
}
