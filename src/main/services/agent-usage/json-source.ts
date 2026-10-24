import { basename, dirname } from 'node:path'
import type { UsageClient } from '../../../shared/agent-usage'
import { normalizeTokens, object, text, usageRecord } from './normalize'
import type { UsageRecord } from './normalize'
import { UsageLogParser } from './jsonl-parser'

/** 非逐行格式也只提取用量元数据，绝不缓存原始对象。 */
export function parseUsageJson(client: UsageClient, path: string, raw: unknown): UsageRecord[] {
  const r = object(raw)
  if (client === 'gemini') {
    const parser = new UsageLogParser(client, path)
    parser.accept(r, 1)
    return parser.finish()
  }
  if (client === 'grok') {
    if (!text(r.sessionId) || !Object.keys(object(r.session)).length)
      throw new Error('unknown statistics snapshot')
    const sid = text(r.sessionId) || basename(dirname(path))
    const hasTurns = Array.isArray(r.turns) && r.turns.length > 0
    const rows = hasTurns ? (r.turns as unknown[]) : [r.session]
    return rows.flatMap((value, i) => {
      const u = object(value)
      if (!Object.keys(u).length) return []
      return [
        usageRecord(
          client,
          sid,
          `turn:${u.turnNumber ?? i}`,
          normalizeTokens(
            {
              input: u.inputTokens,
              output: u.outputTokens,
              cacheRead: u.cachedReadTokens,
              cacheWrite: u.cacheCreationTokens,
              reasoning: u.reasoningTokens,
              total: u.totalTokens
            },
            'included',
            'included',
            false
          ),
          {
            model: u.primaryModelId,
            time: hasTurns ? u.endedAt : null,
            requests: null,
            partial: u.usageIsIncomplete === true || !hasTurns
          }
        )
      ]
    })
  }
  if (client === 'cline') {
    const sid = text(r.sessionId) || basename(path).replace(/\.messages\.json$/, '')
    return Array.isArray(r.messages)
      ? r.messages.flatMap((value) => {
          const m = object(value)
          const u = object(m.metrics)
          if (!Object.keys(u).length) return []
          const id = text(m.id)
          if (!id) return []
          return [
            usageRecord(
              client,
              sid,
              id,
              normalizeTokens(
                {
                  input: u.inputTokens,
                  output: u.outputTokens,
                  cacheRead: u.cacheReadTokens,
                  cacheWrite: u.cacheWriteTokens
                },
                'included'
              ),
              {
                model: object(m.modelInfo).id,
                time: m.ts,
                requests: null,
                partial: u.reasoningTokenCount !== undefined
              }
            )
          ]
        })
      : []
  }
  return []
}
