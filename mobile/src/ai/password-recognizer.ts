/**
 * 密码文本的 AI 识别（手机端）：提示词构造 + 结果解析，均为纯逻辑。
 *
 * 为什么不让模型直接吐 Markdown 表格：解析表格需要处理对齐空格、
 * 转义竖线、模型偶尔多写的「以下是识别结果：」这类前言，脆得很。
 * 这里改成让模型返回**单个 JSON 数组**，解析只需「抠出 JSON → JSON.parse →
 * 逐字段收窄」，出错时能给出可读提示而不是静默丢数据。
 *
 * 兼容性：不少模型即使被要求「只输出 JSON」也会裹一层 ```json 代码围栏，
 * 所以解析前先剥围栏、再从原文里找第一对完整的方括号。
 *
 * 本文件不 import 任何原生模块，可在 vitest 里直接测。
 */
import type { PasswordDraft } from '../shared-bridge'

/** 单次识别的文本上限：太长会让模型截断，得不偿失 */
export const MAX_RECOGNIZE_CHARS = 4000

export const RECOGNIZE_SYSTEM_PROMPT = [
  '你是一个密码条目抽取器。用户会给你一段杂乱文本（可能是聊天记录、表格转储或手写笔记）。',
  '请从中抽出所有能识别出的密码条目，只输出一个 JSON 数组，不要输出任何解释文字，也不要用 Markdown 代码围栏。',
  '数组每个元素是一个对象，字段固定为：',
  'title（必填，网站或服务的名称，没有就根据上下文取最接近的名字）、',
  'url（可选，网址，没有就填空字符串）、',
  'account（可选，账号/用户名/邮箱，没有就填空字符串）、',
  'password（可选，密码，没有就填空字符串）、',
  'remark（可选，备注，没有就填空字符串）。',
  '所有字段都必须是字符串。无法确认的条目直接跳过，不要编造密码。'
].join('\n')

/**
 * 构造用户提示词。
 *
 * 超长文本会**截断**并在末尾说明，让模型知道自己只看到了一部分 ——
 * 这是从粘贴框手输时的既有行为。而文件导入走 `assertRecognizable` 先报错，
 * 因为文件里的内容用户多半没逐字看过，静默截掉一半再让人确认导入风险更大。
 */
export function buildRecognitionPrompt(text: string): string {
  const trimmed = text.trim()
  if (!trimmed) throw new Error('待识别文本不能为空')
  const clipped =
    trimmed.length > MAX_RECOGNIZE_CHARS
      ? `${trimmed.slice(0, MAX_RECOGNIZE_CHARS)}\n（原文过长，以上为前 ${MAX_RECOGNIZE_CHARS} 字）`
      : trimmed
  return `请从下面这段文本里抽取密码条目：\n\n${clipped}`
}

/**
 * 走 AI 通道前的前置校验：先判能不能识别，再花钱调模型。
 *
 * 单独拆出来是为了让「从文件读文本 → 识别」这条路径能在 vitest 里测到
 * 上面这些边界（纯逻辑），不必拉起真机的系统文件选择器。
 */
export function assertRecognizable(text: string): string {
  const trimmed = text.trim()
  if (!trimmed) throw new Error('待识别文本不能为空')
  if (trimmed.length > MAX_RECOGNIZE_CHARS) {
    throw new Error(
      `文本 ${trimmed.length} 字超过单次识别上限 ${MAX_RECOGNIZE_CHARS} 字，请拆分后分批识别`
    )
  }
  return trimmed
}

/**
 * 解析模型回复为草稿数组。
 * 解析失败抛可读错误（宁可让用户重试，也不要静默返回空数组，
 * 那会让人误以为「这段文本里确实没有密码」）。
 */
export function parseRecognitionResult(raw: string): PasswordDraft[] {
  const json = extractJsonValue(raw)
  if (!json) throw new Error('AI 回复里没找到 JSON 结果，请重试或改用「按格式导入」')

  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    throw new Error('AI 返回的 JSON 无法解析，请重试')
  }
  if (!Array.isArray(parsed)) throw new Error('AI 返回的结果不是数组，请重试')

  const drafts: PasswordDraft[] = []
  for (const item of parsed) {
    const draft = toDraft(item)
    if (draft) drafts.push(draft)
  }
  return drafts
}

/**
 * 从模型回复里抠出最外层的 JSON 字面量。
 *
 * 数组与对象都认：模型偶尔不按要求返回数组而返回单个对象，
 * 这时若只找 `[` 会报「没找到 JSON」——JSON 明明在，只是形状不对，
 * 对用户是误导。抠出来后交给调用方区分「形状不对」与「根本没有 JSON」。
 *
 * 逐字符跟踪括号深度与字符串状态，正确跳过字符串里的 `]` / `}` 与转义引号。
 */
export function extractJsonValue(raw: string): string | null {
  const text = stripCodeFence(raw)
  const start = firstBracketIndex(text)
  if (start === -1) return null

  const closing = text[start] === '[' ? ']' : '}'
  let depth = 0
  let inString = false
  let escaped = false

  for (let index = start; index < text.length; index += 1) {
    const char = text[index]

    if (escaped) {
      escaped = false
      continue
    }
    if (char === '\\') {
      if (inString) escaped = true
      continue
    }
    if (char === '"') {
      inString = !inString
      continue
    }
    if (inString) continue

    if (char === text[start]) depth += 1
    else if (char === closing) {
      depth -= 1
      if (depth === 0) return text.slice(start, index + 1)
    }
  }
  return null
}

function firstBracketIndex(text: string): number {
  const array = text.indexOf('[')
  const object = text.indexOf('{')
  if (array === -1) return object
  if (object === -1) return array
  return Math.min(array, object)
}

/** 剥掉 ```json / ``` 围栏；没有围栏时原样返回 */
function stripCodeFence(raw: string): string {
  const fenced = raw.match(/```[a-zA-Z]*\s*\n([\s\S]*?)\n?```/)
  return fenced ? fenced[1] : raw
}

/** 逐字段收窄成 PasswordDraft；名称与密码都空的条目直接丢弃 */
function toDraft(item: unknown): PasswordDraft | null {
  if (typeof item !== 'object' || item === null) return null
  const record = item as Record<string, unknown>

  const title = readString(record['title'])
  const password = readString(record['password'])
  // 名称和密码同时为空 = 模型什么都没识别出来，丢弃以免污染密码箱
  if (!title && !password) return null

  return {
    // 空名交给 savePasswordDrafts 的「名称不能为空」判定，这里给个占位
    title: title || '未命名条目',
    url: readString(record['url']),
    account: readString(record['account']),
    password,
    remark: readString(record['remark'])
  }
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}
