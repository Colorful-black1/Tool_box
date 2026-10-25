import { CODING_AGENT_IDS } from './coding-agents'
import type { CodingAgentId } from './coding-agents'

export const MAX_AGENT_DRAFTS = 100
export const MAX_AGENT_DRAFT_LENGTH = 50_000
export const MAX_AGENT_DRAFT_BYTES = 2 * 1024 * 1024

/** 只保存可重连的原生标识，不保存窗口、连接或执行状态。 */
export interface AgentDraft {
  runtimeId: CodingAgentId
  directory: string
  nativeSessionId: string | null
  content: string
}

/** 版本化明文只在进程内和受控 IPC 中出现，落库前整体加密。 */
export interface AgentDraftDocument {
  version: 1
  selection: { runtimeId: CodingAgentId; directory: string } | null
  drafts: AgentDraft[]
}

export interface AgentDraftSnapshot {
  revision: number
  document: AgentDraftDocument
}

export type AgentDraftSaveInput = AgentDraftSnapshot

/** Windows 项目路径大小写不敏感；POSIX 路径保留大小写。 */
export function normalizeDraftDirectory(directory: string): string {
  let value = directory.replace(/\\/g, '/')
  const windows = /^[a-z]:\//i.test(value) || value.startsWith('//')
  if (windows) value = value.toLowerCase()
  const prefix = /^[a-z]:\//.test(value)
    ? value.slice(0, 3)
    : value.startsWith('//')
      ? '//'
      : value.startsWith('/')
        ? '/'
        : ''
  const parts: string[] = []
  for (const part of value.slice(prefix.length).split('/')) {
    if (!part || part === '.') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }
  return prefix + parts.join('/')
}

export function draftEntryKey(directory: string, nativeSessionId: string | null): string {
  return JSON.stringify([normalizeDraftDirectory(directory), nativeSessionId])
}

export function draftIdentity(draft: Omit<AgentDraft, 'content'>): string {
  return JSON.stringify([draft.runtimeId, draftEntryKey(draft.directory, draft.nativeSessionId)])
}

export function emptyDraftDocument(): AgentDraftDocument {
  return { version: 1, selection: null, drafts: [] }
}

/** IPC 输入与解密后的本地文件同样是不可信数据，只保留规定的字段。 */
export function parseAgentDraftDocument(value: unknown): AgentDraftDocument {
  const object = (value: unknown): Record<string, unknown> => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('草稿格式无效')
    return value as Record<string, unknown>
  }
  const runtime = (value: unknown): CodingAgentId => {
    if (typeof value !== 'string' || !CODING_AGENT_IDS.some((id) => id === value))
      throw new Error('草稿 Agent 无效')
    return value as CodingAgentId
  }
  const directory = (value: unknown): string => {
    if (
      typeof value !== 'string' ||
      value.length > 4096 ||
      value.includes('\0') ||
      !/^(?:[a-z]:[\\/]|\/|\\\\[^\\]+\\[^\\]+)/i.test(value)
    )
      throw new Error('草稿需要绝对项目路径')
    return normalizeDraftDirectory(value)
  }
  const input = object(value)
  if (input.version !== 1 || !Array.isArray(input.drafts) || input.drafts.length > MAX_AGENT_DRAFTS)
    throw new Error('草稿格式无效或条数超过 100 条，请管理草稿后重试')
  const seen = new Set<string>()
  const drafts = input.drafts.map((value) => {
    const item = object(value)
    if (
      item.nativeSessionId !== null &&
      (typeof item.nativeSessionId !== 'string' ||
        !item.nativeSessionId.trim() ||
        item.nativeSessionId.length > 200)
    )
      throw new Error('原生会话标识无效')
    if (
      typeof item.content !== 'string' ||
      !item.content ||
      item.content.length > MAX_AGENT_DRAFT_LENGTH
    )
      throw new Error('草稿正文应为 1 至 50,000 字符')
    const draft: AgentDraft = {
      runtimeId: runtime(item.runtimeId),
      directory: directory(item.directory),
      nativeSessionId: item.nativeSessionId,
      content: item.content
    }
    const key = draftIdentity(draft)
    if (seen.has(key)) throw new Error('草稿身份重复')
    seen.add(key)
    return draft
  })
  const selected = input.selection === null ? null : object(input.selection)
  const document: AgentDraftDocument = {
    version: 1,
    selection: selected
      ? { runtimeId: runtime(selected.runtimeId), directory: directory(selected.directory) }
      : null,
    drafts
  }
  if (new TextEncoder().encode(JSON.stringify(document)).byteLength > MAX_AGENT_DRAFT_BYTES)
    throw new Error('草稿总量超过 2 MiB，请管理草稿后重试')
  return document
}
