import { APP_THEMES } from '../../shared/appearance'
import { validatePromptLibrary } from '../../shared/prompt-tools'

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
  if (Object.hasOwn(patch, 'toolOrder')) {
    if (!Array.isArray(patch.toolOrder) || patch.toolOrder.length > 100)
      throw new Error('工具顺序最多 100 项')
    const order = patch.toolOrder.map((id) => requireString(id, '工具标识', { maxLength: 64 }))
    if (order.some((id) => !/^[a-z][a-z0-9-]{0,63}$/.test(id)))
      throw new Error('工具标识无效')
    if (new Set(order).size !== order.length) throw new Error('工具顺序不能包含重复项')
    validated.toolOrder = order
  }
  if (Object.hasOwn(patch, 'opencode')) {
    const preferences = assertObject(patch.opencode, 'OpenCode 配置')
    validated.opencode = {
      executablePath:
        preferences.executablePath === null
          ? null
          : requireString(preferences.executablePath, 'OpenCode 程序路径', { maxLength: 4096 }),
      directory: requireString(preferences.directory, '项目目录', { maxLength: 4096, allowEmpty: true })
    }
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
