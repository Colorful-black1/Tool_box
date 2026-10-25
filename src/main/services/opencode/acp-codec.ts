import type { OpenCodeSession } from '../../../shared/types'
import { acpPreview as preview, applyAcpUpdate as applyUpdate } from '../coding-agents/acp-codec'

export { acpText, acpOptions } from '../coding-agents/acp-codec'

/** 保留旧预览文案与文本合并行为，DSH 使用通用 codec 的独立名称。 */
export function acpPreview(value: unknown): string {
  return preview(value, 'OpenCode')
}

export function applyAcpUpdate(session: OpenCodeSession, raw: unknown): void {
  applyUpdate(session, raw, 'OpenCode')
}