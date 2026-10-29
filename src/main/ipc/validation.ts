import { APP_THEMES } from '../../shared/appearance'
import type { TodoInput, TodoQuery } from '../../shared/types'

import { MAX_PROMPT_BODY, validatePromptLibrary } from '../../shared/prompt-tools'
import { CODING_AGENT_IDS } from '../../shared/coding-agents'
import { AGENT_CONFIG_KEYS } from '../../shared/agent-projects'
import type {
  AgentCatalogInput,
  AgentCommandInput,
  AgentFileSearchInput,
  AgentReference,
  AgentSendInput
} from '../../shared/agent-actions'
import type { CodingAgentId, CodingAgentSessionInput } from '../../shared/coding-agents'
import { validateAgentRoles } from '../../shared/agent-handoff'
import { MAX_TOOL_FAVORITES, MAX_TOOL_RECENT, validateToolIds } from '../../shared/tool-shortcuts'
import { USAGE_CLIENTS, USAGE_SORT_KEYS } from '../../shared/agent-usage'
import { parseAgentDraftDocument } from '../../shared/agent-drafts'
import type { AgentDraftDocument, AgentDraftSaveInput } from '../../shared/agent-drafts'
import type { UsageClient, UsageQuery, UsageSortKey } from '../../shared/agent-usage'

/** 统计参数独立校验，不复用只包含两个已接入运行时的枚举。 */
export function validateUsageClient(value: unknown): UsageClient {
  if (typeof value !== 'string' || !Object.hasOwn(USAGE_CLIENTS, value))
    throw new Error('统计来源无效')
  return value as UsageClient
}

export function validateUsageQuery(value: unknown): UsageQuery {
  const r = assertObject(value, '统计筛选')
  const result: UsageQuery = {}
  if (r.client !== undefined) result.client = validateUsageClient(r.client)
  if (r.project !== undefined)
    result.project = requireString(r.project, '项目', { maxLength: 4096 })
  if (r.model !== undefined) result.model = requireString(r.model, '模型', { maxLength: 4096 })
  for (const key of ['from', 'to'] as const) {
    if (r[key] === undefined) continue
    const day = requireString(r[key], '日期', { maxLength: 10 })
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(day) ||
      !Number.isFinite(Date.parse(day)) ||
      new Date(day).toISOString().slice(0, 10) !== day
    )
      throw new Error('日期无效')
    result[key] = day
  }
  if (result.from && result.to && result.from > result.to)
    throw new Error('开始日期不能晚于结束日期')
  if (r.offset !== undefined) {
    if (
      typeof r.offset !== 'number' ||
      !Number.isSafeInteger(r.offset) ||
      r.offset < 0 ||
      r.offset > 1_000_000
    )
      throw new Error('分页位置无效')
    result.offset = r.offset
  }
  if (r.limit !== undefined) {
    if (
      typeof r.limit !== 'number' ||
      !Number.isSafeInteger(r.limit) ||
      r.limit < 1 ||
      r.limit > 5000
    )
      throw new Error('分页条数无效')
    result.limit = r.limit
  }
  if (r.sort !== undefined) {
    if (typeof r.sort !== 'string' || !(USAGE_SORT_KEYS as readonly string[]).includes(r.sort))
      throw new Error('排序字段无效')
    result.sort = r.sort as UsageSortKey
  }
  if (r.desc !== undefined) {
    if (typeof r.desc !== 'boolean') throw new Error('排序方向无效')
    result.desc = r.desc
  }
  if (r.refresh !== undefined) {
    if (typeof r.refresh !== 'boolean') throw new Error('刷新参数无效')
    result.refresh = r.refresh
  }
  return result
}

/** 仅携带本地字段校验文案，与系统和原生协议错误分开。 */
export class CodingAgentValidationError extends Error {}

/** 草稿同样在主进程校验；纯解析器也用于解密后的数据。 */
export function validateAgentDraftDocument(value: unknown): AgentDraftDocument {
  return parseAgentDraftDocument(value)
}

export function validateAgentDraftSave(value: unknown): AgentDraftSaveInput {
  const input = assertObject(value, '保存草稿')
  if (typeof input.revision !== 'number' || !Number.isSafeInteger(input.revision) || input.revision < 0)
    throw new Error('草稿修订号无效')
  return { revision: input.revision, document: validateAgentDraftDocument(input.document) }
}

export function validateAgentDraftFlush(value: unknown): { requestId: string; saved: boolean } {
  const input = assertObject(value, '草稿刷新')
  const requestId = requireCodingAgentText(input.requestId, '刷新标识', 100)
  if (typeof input.saved !== 'boolean') throw new Error('草稿刷新状态无效')
  return { requestId, saved: input.saved }
}

function codingAgentObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new CodingAgentValidationError('编程请求应为对象')
  return value as Record<string, unknown>
}

export function validateCodingAgentId(value: unknown): CodingAgentId {
  if (typeof value !== 'string' || !CODING_AGENT_IDS.some((id) => id === value))
    throw new CodingAgentValidationError('编程 Agent 无效')
  return value as CodingAgentId
}

/** 限制 trim 前的长度；所有新协议字符串均在主进程收窄。 */
export function requireCodingAgentText(value: unknown, name: string, maxLength: number): string {
  if (typeof value !== 'string' || value.length > maxLength || !value.trim())
    throw new CodingAgentValidationError(`${name}应为 1 至 ${maxLength} 字符的文本`)
  return value.trim()
}

export function validateCodingAgentSession(value: unknown): CodingAgentSessionInput {
  const input = codingAgentObject(value)
  return {
    runtimeId: validateCodingAgentId(input.runtimeId),
    sessionId: requireCodingAgentText(input.sessionId, '编程会话', 200)
  }
}

export function validateCodingAgentConnect(value: unknown): {
  runtimeId: CodingAgentId
  directory: string
} {
  const input = codingAgentObject(value)
  return {
    runtimeId: validateCodingAgentId(input.runtimeId),
    directory: requireCodingAgentText(input.directory, '项目目录', 4096)
  }
}

export function validateCodingAgentSend(value: unknown): AgentSendInput {
  const input = codingAgentObject(value)
  if (input.literal !== undefined && typeof input.literal !== 'boolean')
    throw new CodingAgentValidationError('文字发送选项无效')
  let references: AgentReference[] | undefined
  if (input.references !== undefined) {
    if (!Array.isArray(input.references) || input.references.length > 20)
      throw new CodingAgentValidationError('最多选择 20 个引用')
    references = input.references.map((value: unknown) => {
      const item = codingAgentObject(value)
      if (item.kind !== 'file' && item.kind !== 'skill' && item.kind !== 'tool')
        throw new CodingAgentValidationError('引用类型无效')
      return {
        id: requireCodingAgentText(item.id, '引用标识', 200),
        kind: item.kind,
        label: requireCodingAgentText(item.label, '引用标签', 4096)
      }
    })
    if (new Set(references.map((item) => item.id)).size !== references.length)
      throw new CodingAgentValidationError('引用不能重复')
  }
  return {
    ...validateCodingAgentSession(input),
    content: requireCodingAgentText(input.content, '编程任务', 50_000),
    references,
    literal: input.literal as boolean | undefined
  }
}

export function validateAgentCatalog(value: unknown): AgentCatalogInput {
  const input = codingAgentObject(value)
  return {
    runtimeId: validateCodingAgentId(input.runtimeId),
    ...(input.sessionId === undefined
      ? {}
      : {
          sessionId: requireCodingAgentText(input.sessionId, '编程会话', 200)
        })
  }
}

export function validateAgentFileSearch(value: unknown): AgentFileSearchInput {
  const input = codingAgentObject(value)
  if (typeof input.query !== 'string' || input.query.length > 200 || /[\0\r\n]/.test(input.query))
    throw new CodingAgentValidationError('文件搜索条件无效')
  return { ...validateCodingAgentConnect(input), query: input.query.trim() }
}

export function validateAgentCommand(value: unknown): AgentCommandInput {
  const input = codingAgentObject(value)
  if (typeof input.arguments !== 'string' || input.arguments.length > 10_000)
    throw new CodingAgentValidationError('命令参数最多 10,000 字符')
  return {
    ...validateCodingAgentSession(input),
    commandId: requireCodingAgentText(input.commandId, '命令标识', 200),
    arguments: input.arguments.trim()
  }
}

export function validateAgentExtensions(value: unknown): {
  runtimeId: CodingAgentId
  directory: string
  enabled: boolean
} {
  const input = codingAgentObject(value)
  if (typeof input.enabled !== 'boolean') throw new CodingAgentValidationError('扩展配置选项无效')
  return { ...validateCodingAgentConnect(input), enabled: input.enabled }
}

export function validateCodingAgentOption(
  value: unknown
): CodingAgentSessionInput & { optionId: string; value: string } {
  const input = codingAgentObject(value)
  return {
    ...validateCodingAgentSession(input),
    optionId: requireCodingAgentText(input.optionId, '配置项', 100),
    value: requireCodingAgentText(input.value, '配置值', 512)
  }
}

export function validateCodingAgentApproval(
  value: unknown
): CodingAgentSessionInput & { approvalId: string; approved: boolean } {
  const input = codingAgentObject(value)
  if (typeof input.approved !== 'boolean') throw new CodingAgentValidationError('审批结果无效')
  return {
    ...validateCodingAgentSession(input),
    approvalId: requireCodingAgentText(input.approvalId, '审批标识', 100),
    approved: input.approved
  }
}

/** 问答只接受有界文本，原生权限和回调对象不能经 IPC 传入。 */
export function validateCodingAgentQuestion(
  value: unknown
): CodingAgentSessionInput & import('../../shared/agent-session').AgentQuestionAnswer {
  const input = codingAgentObject(value)
  if (
    typeof input.cancelled !== 'boolean' ||
    !Array.isArray(input.answers) ||
    input.answers.length > 4
  )
    throw new CodingAgentValidationError('问答结果无效')
  return {
    ...validateCodingAgentSession(input),
    requestId: requireCodingAgentText(input.requestId, '问题引用', 100),
    cancelled: input.cancelled,
    answers: input.answers.map((raw) => {
      const answer = codingAgentObject(raw)
      if (!Array.isArray(answer.values) || answer.values.length > 12)
        throw new CodingAgentValidationError('答案选项无效')
      return {
        questionId: requireCodingAgentText(answer.questionId, '题目引用', 100),
        values: answer.values.map((value) => requireCodingAgentText(value, '答案', 4000))
      }
    })
  }
}

/** 停止引用只能来自端口快照，禁止任意 PID、脚本或命令进入执行服务。 */
export function validatePortStopToken(value: unknown): string {
  if (typeof value !== 'string' || value.length !== 36) throw new Error('进程引用无效，请重新查询端口')
  const token = requireString(value, '进程引用', { maxLength: 36 })
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(token))
    throw new Error('进程引用无效，请重新查询端口')
  return token
}

/** 在 trim 前限制原始 IPC 长度，避免无效空白或大文件拖慢主进程。 */
export function validateCertificateInput(value: unknown): string {
  if (typeof value !== 'string' || value.length > 131072)
    throw new Error('证书内容应为不超过 128 KiB 的文本')
  return requireString(value, '证书内容', { maxLength: 131072 })
}

/** AI 润色接收原文，长度在 trim 前校验，避免空白绕过输入限制。 */
export function validatePromptPolishInput(value: unknown): string {
  if (typeof value === 'string' && value.length > MAX_PROMPT_BODY)
    throw new Error('提示词最多 12000 字符')
  return requireString(value, '提示词', { maxLength: MAX_PROMPT_BODY })
}

export function requireString(
  value: unknown,
  name: string,
  options: { allowEmpty?: boolean; maxLength?: number } = {}
): string {
  if (typeof value !== 'string') {
    throw new Error(`${name}必须是字符串`)
  }
  const trimmed = value.trim()
  if (!options.allowEmpty && !trimmed) {
    throw new Error(`${name}不能为空`)
  }
  if (options.maxLength && trimmed.length > options.maxLength) {
    throw new Error(`${name}长度不能超过 ${options.maxLength} 字符`)
  }
  return trimmed
}

export function requireNonNegativeInt(value: unknown, name: string): number {
  const num = typeof value === 'string' ? Number(value) : value
  if (typeof num !== 'number' || !Number.isInteger(num) || num < 0) {
    throw new Error(`${name}无效`)
  }
  return num
}

export function requireRatio(value: unknown, name: string): number {
  const num = typeof value === 'string' ? Number(value) : value
  if (typeof num !== 'number' || Number.isNaN(num)) {
    throw new Error(`${name}无效`)
  }
  return Math.min(1, Math.max(0, num))
}

export function requireStringArray(value: unknown, name: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${name}必须是数组`)
  return value.map((item, index) => requireString(item, `${name}[${index}]`))
}

/**
 * 可选字符串数组：未传或 null 返回 undefined，其余逐项校验并限量。
 *
 * 用于「可选清单」类入参（例如勾选的模型列表）：
 * 不传 = 不改动，[] = 清空，两种语义要区分开，所以不能用 requireStringArray。
 */
export function optionalStringArray(
  value: unknown,
  name: string,
  options: { maxItems?: number; maxLength?: number } = {}
): string[] | undefined {
  if (value === undefined || value === null) return undefined
  if (!Array.isArray(value)) throw new Error(`${name}必须是数组`)
  if (options.maxItems && value.length > options.maxItems) {
    throw new Error(`${name}最多 ${options.maxItems} 项`)
  }
  return value.map((item, index) =>
    requireString(item, `${name}[${index}]`, { maxLength: options.maxLength })
  )
}

/** 枚举 / 白名单校验：动态排序、供应商 id 等外部可控的固定选项必须走这里 */
export function requireEnum<T extends string>(
  value: unknown,
  name: string,
  allowed: readonly T[]
): T {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    throw new Error(`${name}无效`)
  }
  return value as T
}

/** 可选字符串：未传或空串返回 undefined，其余走 requireString 校验 */
export function optionalString(
  value: unknown,
  name: string,
  options: { maxLength?: number } = {}
): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  return requireString(value, name, { maxLength: options.maxLength })
}

export function assertObject(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${name}无效`)
  }
  return value as Record<string, unknown>
}

/** 校验工具与外观的新增字段，保留既有阅读配置和快捷键的合并语义。 */
export function validateConfigPatch(value: unknown): Record<string, unknown> {
  const patch = assertObject(value, '配置')
  const validated = { ...patch }
  if (Object.hasOwn(patch, 'appearance')) {
    const appearance = assertObject(patch.appearance, '外观配置')
    const theme = requireEnum(appearance.theme, '应用主题', APP_THEMES)
    if (typeof appearance.backgroundMotion !== 'boolean') throw new Error('背景动效设置无效')
    validated.appearance = { theme, backgroundMotion: appearance.backgroundMotion }
  }
  if (Object.hasOwn(patch, 'promptTemplates'))
    validated.promptTemplates = validatePromptLibrary(patch.promptTemplates)
  if (Object.hasOwn(patch, 'agentRoles'))
    validated.agentRoles = validateAgentRoles(patch.agentRoles)
  if (Object.hasOwn(patch, 'toolOrder')) {
    if (!Array.isArray(patch.toolOrder) || patch.toolOrder.length > 100)
      throw new Error('工具顺序最多 100 项')
    const order = patch.toolOrder.map((id) => requireString(id, '工具标识', { maxLength: 64 }))
    if (order.some((id) => !/^[a-z][a-z0-9-]{0,63}$/.test(id))) throw new Error('工具标识无效')
    if (new Set(order).size !== order.length) throw new Error('工具顺序不能包含重复项')
    validated.toolOrder = order
  }
  if (Object.hasOwn(patch, 'toolFavorites'))
    validated.toolFavorites = validateToolIds(patch.toolFavorites, MAX_TOOL_FAVORITES)
  if (Object.hasOwn(patch, 'toolRecent'))
    validated.toolRecent = validateToolIds(patch.toolRecent, MAX_TOOL_RECENT)
  for (const runtime of CODING_AGENT_IDS) {
    const key = AGENT_CONFIG_KEYS[runtime]
    const alias = runtime === 'claude-desktop' && Object.hasOwn(patch, runtime)
    if (alias && Object.hasOwn(patch, key)) throw new Error('Claude Desktop 配置不能同时提供新旧键')
    if (!alias && !Object.hasOwn(patch, key)) continue
    const preferences = assertObject(patch[alias ? runtime : key], '编程 Agent 配置')
    const fields: Record<string, unknown> = {}
    if (Object.hasOwn(preferences, 'executablePath'))
      fields.executablePath =
        preferences.executablePath === null
          ? null
          : requireString(preferences.executablePath, 'Agent 程序路径', { maxLength: 4096 })
    if (Object.hasOwn(preferences, 'directory'))
      fields.directory = requireString(preferences.directory, '项目目录', {
        maxLength: 4096,
        allowEmpty: true
      })
    if (!Object.keys(fields).length) throw new Error('编程 Agent 配置没有可更新字段')
    if (alias) delete validated[runtime]
    validated[key] = fields
  }
  return validated
}

/** 所有工作台 IPC 入参均先收敛，再交给不依赖 Electron 的业务服务。 */
export function validateOpenCodeInput(value: unknown): { sessionId: string; content: string } {
  const input = assertObject(value, 'OpenCode 请求')
  return {
    sessionId: requireString(input.sessionId, '编程会话', { maxLength: 200 }),
    content: requireString(input.content, '编程任务', { maxLength: 50_000 })
  }
}

export function validateOpenCodeOption(value: unknown): {
  sessionId: string
  optionId: string
  value: string
} {
  const input = assertObject(value, 'OpenCode 配置项')
  return {
    sessionId: requireString(input.sessionId, '编程会话', { maxLength: 200 }),
    optionId: requireString(input.optionId, '配置项', { maxLength: 100 }),
    value: requireString(input.value, '配置值', { maxLength: 512 })
  }
}

export function validateOpenCodeApproval(value: unknown): {
  sessionId: string
  approvalId: string
  approved: boolean
} {
  const input = assertObject(value, 'OpenCode 审批')
  if (typeof input.approved !== 'boolean') throw new Error('审批结果无效')
  return {
    sessionId: requireString(input.sessionId, '编程会话', { maxLength: 200 }),
    approvalId: requireString(input.approvalId, '审批标识', { maxLength: 100 }),
    approved: input.approved
  }
}

/** 待办写入与分页均在主进程校验，不依赖日期输入控件。 */
export function validateTodoInput(value: unknown): TodoInput {
  const body = assertObject(value, '待办内容')
  const date = (input: unknown): number | null => {
    if (input === null) return null
    if (
      typeof input !== 'number' ||
      !Number.isSafeInteger(input) ||
      input < 0 ||
      input > 253402300799999
    )
      throw new Error('待办日期时间无效')
    return input
  }
  const startAtMs = date(body.startAtMs)
  const dueAtMs = date(body.dueAtMs)
  if (startAtMs !== null && dueAtMs !== null && startAtMs > dueAtMs)
    throw new Error('开始时间不能晚于截止时间')
  return {
    id: optionalString(body.id, '待办 ID', { maxLength: 64 }),
    title: requireString(body.title, '待办标题', { maxLength: 120 }).trim(),
    details: requireString(body.details, '待办备注', { allowEmpty: true, maxLength: 4000 }),
    priority: requireEnum(body.priority, '优先级', ['low', 'normal', 'high'] as const),
    startAtMs,
    dueAtMs,
    remind: requireTodoBoolean(body.remind)
  }
}

export function requireTodoBoolean(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new Error('待办状态无效')
  return value
}

export function validateTodoQuery(value: unknown): TodoQuery {
  const body = assertObject(value, '待办筛选')
  const offset = requireNonNegativeInt(body.offset, '分页位置')
  const limit = requireNonNegativeInt(body.limit, '分页数量')
  if (offset > 1000000 || limit < 1 || limit > 100) throw new Error('待办分页范围无效')
  return {
    filter: requireEnum(body.filter, '待办筛选', [
      'all',
      'today',
      'upcoming',
      'overdue',
      'completed',
      'archived'
    ] as const),
    focusId: optionalString(body.focusId, '待办 ID', { maxLength: 64 }),
    search: requireString(body.search, '搜索内容', { allowEmpty: true, maxLength: 120 }).trim(),
    offset,
    limit
  }
}
