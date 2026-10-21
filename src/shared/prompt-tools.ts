import { checkToolInput } from './json-tools'

export const MAX_PROMPT_TEMPLATES = 20
export const MAX_PROMPT_BODY = 12_000
export const MAX_PROMPT_HISTORY = 6
const MAX_LIBRARY_CHARS = 180_000

/** 历史版本仅包含模板定义，不包含本次填入的变量值。 */
export interface PromptVersion {
  title: string
  body: string
  savedAtMs: number
}
/** 当前模板及有界历史；全部字段均可通过现有配置桥接序列化。 */
export interface PromptTemplate {
  id: string
  title: string
  body: string
  updatedAtMs: number
  versions: PromptVersion[]
}

const BUILT_INS = [
  [
    'java-error',
    'Java 异常分析',
    '请分析下面的 Java 日志。先列出日志能证实的事实，再给出可能原因、验证步骤与最小修复建议。信息不足时明确列出缺少的信息，不要编造运行环境。\n\n{{context}}'
  ],
  [
    'code-review',
    '代码审查',
    '请审查下面的代码，按正确性、并发、边界条件、安全和可维护性列出具体问题。每个问题给出触发场景、影响与最小修改建议。\n\n{{context}}'
  ],
  [
    'refactor',
    '保行为重构',
    '请在保持现有行为与对外接口的前提下重构以下代码。先说明当前行为，再给出最小修改、理由和回归验证方案。\n\n{{context}}'
  ],
  [
    'sql',
    'SQL 优化',
    '请分析以下 SQL 和已提供的表结构、索引、执行计划。先指出已知信息和缺失信息，再给出优化建议及验证方法，不要假设未知数据库版本或数据分布。\n\n{{context}}'
  ],
  [
    'unit-tests',
    '单测生成',
    '请为以下 Java 代码设计单元测试，覆盖正常行为、边界、异常和必要的并发场景。沿用给出的测试框架；未提供依赖或环境时先说明假设。\n\n{{context}}'
  ]
] as const

export function defaultPromptTemplates(): PromptTemplate[] {
  return BUILT_INS.map(([id, title, body]) => ({
    id: 'builtin-' + id,
    title,
    body,
    updatedAtMs: 0,
    versions: []
  }))
}

export function promptVariables(body: string): string[] {
  const variables = [
    ...new Set(
      [...body.matchAll(/\{\{\s*([\p{L}_][\p{L}\p{N}_]{0,39})\s*\}\}/gu)].map((match) => match[1])
    )
  ]
  if (variables.length > 12) throw new Error('每个模板最多 12 个变量')
  return variables
}

export function fillPrompt(body: string, values: Record<string, string>): string {
  if (body.length > MAX_PROMPT_BODY) throw new Error('模板正文最多 12000 字符')
  const missing = promptVariables(body).filter(
    (name) => !Object.hasOwn(values, name) || !values[name].trim()
  )
  if (missing.length) throw new Error('请填写变量：' + missing.join('、'))
  // 一次替换，不把变量值中的 {{...}} 再次当成模板执行。
  const output = body.replace(
    /\{\{\s*([\p{L}_][\p{L}\p{N}_]{0,39})\s*\}\}/gu,
    (_match, name: string) => values[name]
  )
  checkToolInput(output)
  return output
}

/** 供主进程配置边界和渲染层加载共用；只返回白名单字段，限制总量。 */
export function validatePromptLibrary(raw: unknown): PromptTemplate[] {
  if (!Array.isArray(raw) || raw.length > MAX_PROMPT_TEMPLATES)
    throw new Error('模板列表无效，最多 20 项')
  const ids = new Set<string>()
  let total = 0
  const object = (value: unknown): Record<string, unknown> => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('模板内容无效')
    return value as Record<string, unknown>
  }
  const string = (value: unknown, max: number, name: string): string => {
    if (typeof value !== 'string' || !value.trim() || value.length > max)
      throw new Error(`${name}无效或超过长度上限`)
    total += value.length
    if (max === MAX_PROMPT_BODY) promptVariables(value)
    return value
  }
  const time = (value: unknown): number => {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
      throw new Error('模板版本时间无效')
    return value
  }
  const library = Array.from(raw, (item): PromptTemplate => {
    const value = object(item)
    const id = string(value.id, 64, '模板标识')
    if (!/^[A-Za-z0-9_-]+$/.test(id) || ids.has(id)) throw new Error('模板标识无效或重复')
    ids.add(id)
    if (!Array.isArray(value.versions) || value.versions.length > MAX_PROMPT_HISTORY)
      throw new Error('模板历史版本最多 6 项')
    return {
      id,
      title: string(value.title, 60, '模板名称').trim(),
      body: string(value.body, MAX_PROMPT_BODY, '模板正文'),
      updatedAtMs: time(value.updatedAtMs),
      versions: Array.from(value.versions, (entry): PromptVersion => {
        const version = object(entry)
        return {
          title: string(version.title, 60, '版本名称').trim(),
          body: string(version.body, MAX_PROMPT_BODY, '版本正文'),
          savedAtMs: time(version.savedAtMs)
        }
      })
    }
  })
  if (total > MAX_LIBRARY_CHARS) throw new Error('模板与历史总量超过 18 万字符，请缩短正文')
  return library
}

export function savePromptRevision(
  previous: PromptTemplate | undefined,
  draft: {
    id: string
    title: string
    body: string
  },
  now: number
): PromptTemplate {
  const title = draft.title.trim()
  if (previous && previous.title === title && previous.body === draft.body) return previous
  const versions = previous
    ? [
        { title: previous.title, body: previous.body, savedAtMs: previous.updatedAtMs },
        ...previous.versions
      ].slice(0, MAX_PROMPT_HISTORY)
    : []
  const next = { ...draft, title, updatedAtMs: now, versions }
  return validatePromptLibrary([next])[0]
}
