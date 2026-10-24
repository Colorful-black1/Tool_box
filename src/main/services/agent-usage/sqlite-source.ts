import Database from 'better-sqlite3'
import { setImmediate } from 'node:timers/promises'
import type { UsageClient } from '../../../shared/agent-usage'
import { count, normalizeTokens, object, text, usageRecord } from './normalize'
import type { UsageRecord } from './normalize'

// SQL 固定投影统计字段；不读取正文、凭据、raw_usage_json 或 provider_metadata_json。
const OPEN_MESSAGES = `SELECT m.id, m.session_id, s.directory AS project, m.time_created AS time,
  json_extract(m.data,'$.modelID') AS model,
  json_extract(m.data,'$.providerID') AS provider,
  json_extract(m.data,'$.cost') AS cost,
  json_extract(m.data,'$.tokens.input') AS input,
  json_extract(m.data,'$.tokens.output') AS output,
  json_extract(m.data,'$.tokens.reasoning') AS reasoning,
  json_extract(m.data,'$.tokens.cache.read') AS cacheRead,
  json_extract(m.data,'$.tokens.cache.write') AS cacheWrite,
  json_extract(m.data,'$.tokens.total') AS total
  FROM message m LEFT JOIN session s ON s.id=m.session_id
  WHERE json_valid(m.data) AND json_extract(m.data,'$.role')='assistant'`

// 新版把模型写成对象；取 id，避免整段 JSON 进入模型筛选与明细。
const OPEN_V2 = `SELECT m.id, m.session_id, s.directory AS project, m.time_created AS time,
  COALESCE(json_extract(m.data,'$.model.id'),json_extract(m.data,'$.model.modelID')) AS model,
  COALESCE(json_extract(m.data,'$.model.providerID'),json_extract(m.data,'$.providerID')) AS provider,
  json_extract(m.data,'$.cost') AS cost,
  json_extract(m.data,'$.tokens.input') AS input,
  json_extract(m.data,'$.tokens.output') AS output,
  json_extract(m.data,'$.tokens.reasoning') AS reasoning,
  json_extract(m.data,'$.tokens.cache.read') AS cacheRead,
  json_extract(m.data,'$.tokens.cache.write') AS cacheWrite,
  json_extract(m.data,'$.tokens.total') AS total
  FROM session_message m LEFT JOIN session_v2 s ON s.id=m.session_id
  WHERE m.type='assistant' AND json_valid(m.data)`

const ZCODE = `SELECT u.id, u.session_id, s.directory AS project, u.model_id AS model,
  u.started_at AS time, u.input_tokens AS input, u.output_tokens AS output,
  u.reasoning_tokens AS reasoning, u.cache_read_input_tokens AS cacheRead,
  u.cache_creation_input_tokens AS cacheWrite, u.computed_total_tokens AS total
  FROM model_usage u LEFT JOIN session s ON s.id=u.session_id`

const COPILOT = `SELECT u.id, u.session_id, s.cwd AS project, u.model,
  u.created_at AS time, u.input_tokens AS input, u.output_tokens AS output,
  u.cache_read_tokens AS cacheRead, u.cache_write_tokens AS cacheWrite,
  u.reasoning_tokens AS reasoning FROM assistant_usage_events u
  LEFT JOIN sessions s ON s.id=u.session_id`

/**
 * OpenAI 系供应商把推理算进输出，汇总时不能再加一次；
 * 其它供应商（OpenCode Go / DeepSeek / 小米等）的推理是独立桶。
 */
const REASONING_IN_OUTPUT = new Set(['openai', 'github-copilot', 'alibaba-cn', 'opencode'])

/** 有界批次读取，刷新期间让出主线程；同一来源使用只读事务的一致快照。 */
export async function readUsageDatabase(client: UsageClient, file: string): Promise<UsageRecord[]> {
  const db = new Database(file, { readonly: true, fileMustExist: true, timeout: 500 })
  try {
    db.pragma('query_only = ON')
    db.exec('BEGIN')
    const exists = (name: string): boolean =>
      Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name))
    const records = new Map<string, UsageRecord>()
    const read = async (sql: string): Promise<void> => {
      let i = 0
      for (const value of db.prepare(sql).iterate()) {
        const r = object(value)
        const id = typeof r.id === 'number' ? String(r.id) : text(r.id)
        const sid = text(r.session_id)
        if (!id || !sid) continue
        const separate = client === 'opencode' || client === 'mimocode' || client === 'mcode'
        const provider = text(r.provider)
        // Copilot 的原生 input 包含两类缓存；先拆未缓存输入，统一语义仍保留原总量。
        // OpenCode 的原生 total 含缓存写入；MCode 的推理归属未确认，先不计入并标记不完整。
        const reasoning =
          separate && client !== 'mcode' && !REASONING_IN_OUTPUT.has(provider)
            ? 'separate'
            : 'included'
        const tokens = normalizeTokens(
          {
            input: r.input,
            output: r.output,
            cacheRead: r.cacheRead,
            cacheWrite: r.cacheWrite,
            reasoning: r.reasoning,
            total: r.total
          },
          separate ? 'separate' : 'included',
          reasoning,
          client !== 'zcode'
        )
        // 空 usage 的助手消息（中断、纯工具回合）不是用量记录，不能把整个来源标成不完整。
        if (Object.values(tokens).every((value) => value === null)) continue
        // ZCode 本机 939 条记录的原生 total 均为 input+output；缓存是输入明细。
        let time = r.time
        if (
          client === 'copilot' &&
          typeof time === 'string' &&
          /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(time)
        )
          time = time.replace(' ', 'T') + 'Z'
        records.set(
          `${sid}:${id}`,
          usageRecord(client, sid, id, tokens, {
            project: r.project,
            model: r.model,
            time,
            cost: r.cost,
            // 只有 MCode 的推理归属尚未确认；OpenCode 的缓存写入已计入原生总量。
            partial: client === 'mcode' && (count(r.reasoning) ?? 0) > 0
          })
        )
        if (++i > 500_000) throw new Error('source limit')
        if (i % 250 === 0) await setImmediate()
      }
    }
    if (client === 'opencode' || client === 'mimocode') {
      const v2 = new Set<string>()
      if (client === 'opencode' && exists('session_message') && exists('session_v2')) {
        await read(OPEN_V2)
        for (const r of records.values()) v2.add(r.sessionId)
      }
      const before = new Map(records)
      if (!exists('message') && !exists('session_message')) throw new Error('unknown source schema')
      if (exists('message')) await read(OPEN_MESSAGES)
      // 新旧表迁移期间，一个会话只选一套明细；不能把镜像全加上。
      for (const [key, r] of records)
        if (v2.has(r.sessionId) && !before.has(key)) records.delete(key)
      for (const [key, r] of before) records.set(key, r)
      // 只排除导入消息，保留导入会话后续产生的本机请求。
      if (client === 'mimocode') {
        const imported = new Set<string>()
        if (exists('claude_import'))
          for (const value of db
            .prepare('SELECT session_id,message_ids FROM claude_import')
            .iterate()) {
            const row = object(value)
            const ids: unknown = JSON.parse(String(row.message_ids))
            if (Array.isArray(ids))
              for (const id of ids) imported.add(`${text(row.session_id)}:${text(id)}`)
          }
        if (exists('external_import'))
          for (const value of db
            .prepare('SELECT session_id,message_ids FROM external_import')
            .iterate()) {
            const row = object(value)
            const ids: unknown = JSON.parse(String(row.message_ids))
            if (Array.isArray(ids))
              for (const id of ids) imported.add(`${text(row.session_id)}:${text(id)}`)
          }
        for (const [key, r] of records)
          if (imported.has(`${r.sessionId}:${r.id}`)) records.delete(key)
      }
    } else if (client === 'zcode') await read(ZCODE)
    else if (client === 'copilot') await read(COPILOT)
    else if (client === 'mcode') {
      await read(`SELECT u.id,u.session_id,s.workspace_dir AS project,u.model,
        u.ts AS time,u.input_tokens AS input,u.output_tokens AS output,
        u.cache_read_tokens AS cacheRead,u.cache_write_tokens AS cacheWrite,
        u.reasoning_tokens AS reasoning FROM local_runtime_token_usage u
        LEFT JOIN local_runtime_sessions s ON s.session_id=u.session_id`)
    }
    db.exec('ROLLBACK')
    return [...records.values()]
  } finally {
    db.close()
  }
}
