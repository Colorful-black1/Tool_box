import { createHash } from 'node:crypto'
import type { CodexPeer } from './codex-adapter'
import type { NativeCodingSession, NativeRevertPreview } from './adapter'
import { CodingAgentError } from './adapter'
import { applyCodexItem } from './codex-codec'
import { codexObject, codexText } from './codex-connection'

/** 完整且有界的分页快照；超限、重复游标或缺失轮次身份均拒绝回退。 */
export interface CodexHistory {
  revision: string
  turns: Array<{ id: string; fingerprint: string; messages: NativeCodingSession['messages'] }>
  session: NativeCodingSession
}

export async function readCodexHistory(
  peer: CodexPeer,
  session: NativeCodingSession,
  checkThread: (thread: Record<string, unknown>) => boolean,
  recent = false
): Promise<CodexHistory> {
  const read = codexObject(
    await peer.request('thread/read', { threadId: session.id, includeTurns: false })
  )
  const thread = codexObject(read?.thread)
  if (
    !thread ||
    !checkThread(thread) ||
    thread.historyMode !== 'paginated' ||
    codexObject(thread.status)?.type !== 'idle'
  )
    throw new CodingAgentError('当前原生会话不支持安全回退，或仍在执行；请在原生客户端核对')
  const fresh: NativeCodingSession = {
    ...structuredClone(session),
    messages: [],
    tools: [],
    subtasks: [],
    approvals: [],
    questions: [],
    status: 'ready',
    outcome: 'completed',
    error: '',
    contextUsage: undefined,
    timing: undefined,
    canRevert: true
  }
  const turns: CodexHistory['turns'] = []
  const seen = new Set<string>()
  const seenItems = new Set<string>()
  const hash = createHash('sha256')
  let cursor: string | undefined
  let totalBytes = 0
  do {
    const page = codexObject(
      await peer.request('thread/turns/list', {
        threadId: session.id,
        cursor,
        limit: 50,
        sortDirection: recent ? 'desc' : 'asc',
        itemsView: 'full'
      })
    )
    if (
      !Array.isArray(page?.data) ||
      (page.nextCursor !== undefined &&
        page.nextCursor !== null &&
        typeof page.nextCursor !== 'string')
    )
      throw new CodingAgentError('原生历史分页不完整，未提供回退操作')
    for (const raw of recent ? page.data.slice().reverse() : page.data) {
      const turn = codexObject(raw)
      const id = codexText(turn?.id)
      if (
        !id ||
        turns.some((item) => item.id === id) ||
        turns.length >= 100 ||
        !['completed', 'failed', 'interrupted'].includes(String(turn?.status)) ||
        !Array.isArray(turn?.items) ||
        (turn.itemsView !== undefined && turn.itemsView !== 'full')
      )
        throw new CodingAgentError('原生轮次不完整、仍在运行或历史过长，请在原生客户端处理')
      const encoded = JSON.stringify(raw)
      totalBytes += Buffer.byteLength(encoded)
      if (totalBytes > 2_000_000) throw new CodingAgentError('原生历史过长，请在原生客户端处理')
      hash.update(encoded)
      const start = fresh.messages.length
      for (const item of turn.items) {
        const itemId = codexText(codexObject(item)?.id)
        if (!itemId || seenItems.has(itemId))
          throw new CodingAgentError('原生消息身份缺失或重复，未提供回退操作')
        seenItems.add(itemId)
        applyCodexItem(fresh, item)
      }
      turns.push({
        id,
        fingerprint: createHash('sha256').update(encoded).digest('hex'),
        messages: fresh.messages.slice(start)
      })
    }
    cursor = typeof page.nextCursor === 'string' && page.nextCursor ? page.nextCursor : undefined
    if (recent) {
      if (cursor)
        fresh.error = '仅显示最近 50 轮；回退前会另外核对完整历史，超限时需在原生客户端处理'
      break
    }
    if (cursor && (seen.has(cursor) || !page.data.length))
      throw new CodingAgentError('原生历史分页重复，未提供回退操作')
    if (cursor) seen.add(cursor)
  } while (cursor)
  const revision = hash.digest('hex')
  fresh.historyRevision = revision
  return { revision, turns, session: fresh }
}

export function codexRevertPreview(
  history: CodexHistory,
  messageId: string,
  turnId?: string
): NativeRevertPreview {
  const index = history.turns.findIndex((turn) =>
    turnId
      ? turn.id === turnId
      : turn.messages.some((message) => message.id === messageId && message.role === 'user')
  )
  if (index < 0) throw new CodingAgentError('消息尚无可靠原生轮次，请核对原生历史后重新选择')
  const target = history.turns[index]
  const users = target.messages.filter((message) => message.role === 'user')
  // 一个轮次若包含追加/排队用户消息，不能将其中一条伪装为独立回退边界。
  if (users.length !== 1 || (!turnId && users[0].id !== messageId))
    throw new CodingAgentError('此轮包含多条用户输入，暂不支持按这条消息回退')
  const messages = history.turns.slice(index).flatMap((turn) => turn.messages)
  return {
    revision: history.revision,
    beforeTurnId: target.id,
    affectedTurns: history.turns.length - index,
    affectedMessages: messages.length,
    tail: messages.map((message) => ({
      role: message.role,
      content: message.content.slice(0, 160)
    })),
    originalText: users[0].content
  }
}
