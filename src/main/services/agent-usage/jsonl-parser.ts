import { basename, dirname } from 'node:path'
import type { UsageClient, UsageTokens } from '../../../shared/agent-usage'
import { count, normalizeTokens, object, sum, text, usageRecord } from './normalize'
import type { UsageRecord } from './normalize'

/** 一个文件的流式统计投影。正文只在单行解析期间存在，绝不加入缓存。 */
export class UsageLogParser {
  private session: string
  private project = ''
  private model = ''
  private parent = ''
  private modern = new Map<string, UsageRecord>()
  private legacy = new Map<string, UsageRecord>()
  private attempts = new Map<string, number>()
  private lastAttempt = ''
  private seedCut = 0
  private seeded = false
  private seedConfirmed = true
  private protocol = ''
  private cumulativeTotal: number | null = null
  private cumulativeEpoch = 0
  private cumulativeSnapshots = new Map<string, UsageRecord>()
  private parentCut: number | null = null
  private dshHeaderValid = false
  private rows = new Map<string, UsageRecord>()
  issues = 0

  constructor(
    private client: UsageClient,
    private path: string
  ) {
    this.session = basename(path).replace(/\.jsonl(?:\.zstd)?$/, '')
    if (client === 'kimi' || client === 'dsh') this.session = basename(dirname(path))
    if (client === 'kimi' && basename(dirname(dirname(path))) === 'agents')
      this.session = basename(dirname(dirname(dirname(path))))
  }

  private put(
    id: string,
    tokens: UsageTokens,
    time: unknown,
    target = this.rows,
    session = this.session
  ): void {
    if (!id || !session) {
      this.issues++
      return
    }
    target.set(
      id,
      usageRecord(this.client, session, id, tokens, {
        project: this.project,
        model: this.model,
        time
      })
    )
  }

  accept(raw: unknown, line: number): void {
    const r = object(raw)
    switch (this.client) {
      case 'codex':
        this.codex(r, line)
        break
      case 'claude':
        this.claude(r)
        break
      case 'kimi':
        this.kimi(r, line)
        break
      case 'pi':
        this.pi(r)
        break
      case 'workbuddy':
        this.workbuddy(r)
        break
      case 'dsh':
        this.dsh(r)
        break
      case 'gemini':
        this.gemini(r)
        break
    }
  }

  finish(): UsageRecord[] {
    if (this.client === 'dsh' && this.seeded && !this.seedConfirmed) {
      this.issues++
      return []
    }
    const rows =
      this.client === 'codex'
        ? [...(this.modern.size ? this.modern : this.legacy).values()]
        : [...this.rows.values()]
    return [...rows, ...this.cumulativeSnapshots.values()].map((row) => ({
      ...row,
      project: row.project || this.project,
      partial: row.partial || this.issues > 0
    }))
  }

  private codex(r: Record<string, unknown>, line: number): void {
    const p = object(r.payload)
    if (r.type === 'session_meta') {
      this.session = text(p.id) || this.session
      this.project = text(p.cwd)
      this.parent = text(object(p.history_base).thread_id)
      this.parentCut = count(object(p.history_base).end_ordinal_exclusive)
      this.model = text(object(object(p.base_instructions).provenance).model)
    } else if (r.type === 'turn_context') {
      this.model = text(p.model) || this.model
      this.project = text(p.cwd) || this.project
    }
    const modern = r.type === 'token_usage_record'
    if (!modern && !(r.type === 'event_msg' && p.type === 'token_count')) return
    const info = object(p.info)
    const u = object(modern ? p.usage : info.last_token_usage)
    if (!Object.keys(u).length) return
    const cumulative = object(modern ? p.thread_token_usage : info.total_token_usage)
    let session = text(p.thread_id) || this.session
    // 继承记录若明确属于父线程，按父身份去重；无法定位的继承快照不冒充新请求。
    const ordinal = count(r.ordinal)
    if (this.parent && !text(p.thread_id)) {
      if (ordinal === null || this.parentCut === null) {
        this.issues++
        return
      }
      if (ordinal < this.parentCut) session = this.parent
    }
    const cumulativeTotal = count(cumulative.total_tokens)
    if (
      cumulativeTotal !== null &&
      this.cumulativeTotal !== null &&
      cumulativeTotal < this.cumulativeTotal
    )
      this.cumulativeEpoch++
    if (cumulativeTotal !== null) this.cumulativeTotal = cumulativeTotal
    const key =
      text(p.response_id) ||
      (ordinal !== null
        ? `ordinal:${ordinal}`
        : Object.keys(cumulative).length
          ? `epoch:${this.cumulativeEpoch}:total:${JSON.stringify(cumulative)}`
          : `line:${line}`)
    if (!text(p.response_id) && ordinal === null && !Object.keys(cumulative).length) this.issues++
    const tokens = normalizeTokens(
      {
        input: u.input_tokens,
        output: u.output_tokens,
        cacheRead: u.cached_input_tokens,
        cacheWrite: u.cache_write_input_tokens,
        reasoning: u.reasoning_output_tokens,
        total: u.total_tokens
      },
      'included',
      'included',
      false
    )
    if (Object.keys(cumulative).length) {
      const total = normalizeTokens(
        {
          input: cumulative.input_tokens,
          output: cumulative.output_tokens,
          cacheRead: cumulative.cached_input_tokens,
          cacheWrite: cumulative.cache_write_input_tokens,
          reasoning: cumulative.reasoning_output_tokens,
          total: cumulative.total_tokens
        },
        'included',
        'included',
        false
      )
      const old = this.cumulativeSnapshots.get(session)
      if (total.total !== null && total.total >= (old?.tokens.total ?? -1)) {
        this.cumulativeSnapshots.set(session, {
          ...usageRecord('codex', session, 'native-cumulative', total, {
            project: this.project,
            requests: null
          }),
          snapshot: true
        })
      }
    }
    this.put(key, tokens, r.timestamp ?? p.timestamp, modern ? this.modern : this.legacy, session)
  }

  private claude(r: Record<string, unknown>): void {
    this.session = text(r.sessionId) || this.session
    this.project = text(r.cwd) || this.project
    if (r.type !== 'assistant') return
    const message = object(r.message)
    if (message.model === '<synthetic>') return
    const u = object(message.usage)
    if (!Object.keys(u).length) return
    this.model = text(message.model)
    this.put(
      text(message.id),
      normalizeTokens(
        {
          input: u.input_tokens,
          output: u.output_tokens,
          cacheRead: u.cache_read_input_tokens ?? 0,
          cacheWrite: u.cache_creation_input_tokens ?? 0
        },
        'separate'
      ),
      r.timestamp
    )
  }

  private kimi(r: Record<string, unknown>, line: number): void {
    if (r.type === 'metadata') {
      this.protocol = text(r.protocol_version)
      if (!['1.1', '1.4', '1.5'].includes(this.protocol)) this.issues++
      this.session = text(r.session_id) || this.session
      this.project = text(r.work_dir) || text(r.cwd)
      return
    }
    if (!['1.1', '1.4', '1.5'].includes(this.protocol)) return
    const payload = object(object(r.message).payload)
    const u = object(this.protocol === '1.1' ? payload.token_usage : r.usage)
    if (this.protocol !== '1.1' && r.type !== 'usage.record') return
    if (!Object.keys(u).length) return
    if (r.usageScope && !['session', 'turn'].includes(text(r.usageScope))) {
      this.issues++
      return
    }
    this.model = text(r.model) || this.model
    const key = text(payload.message_id) || `${basename(dirname(this.path))}:line:${line}`
    this.put(
      key,
      normalizeTokens(
        {
          input: u.inputOther ?? u.input_other,
          output: u.output,
          cacheRead: u.inputCacheRead ?? u.input_cache_read,
          cacheWrite: u.inputCacheCreation ?? u.input_cache_creation
        },
        'separate'
      ),
      this.protocol === '1.1' ? Number(r.timestamp) * 1000 : r.time
    )
  }

  private pi(r: Record<string, unknown>): void {
    if (r.type === 'session') {
      this.session = text(r.id) || text(r.sessionId) || this.session
      this.project = text(r.cwd)
      return
    }
    const m = object(r.message)
    const meta = object(r.meta)
    if ((m.role ?? r.role) !== 'assistant') return
    const u = object(m.usage ?? meta.usage)
    if (!Object.keys(u).length) return
    this.model = text(m.model ?? meta.modelId)
    // Desktop 的聚合块可能嵌套多个实际操作，只统计操作明细，不能再加一遍聚合。
    const operations = Array.isArray(u.operations) && u.operations.length ? u.operations : [u]
    const operationTotals = new Map<string, number | null>()
    for (const value of operations) {
      const op = object(value)
      this.model = text(op.modelId) || this.model
      const id = text(op.operationId) || (operations.length === 1 ? text(r.id) : '')
      const tokens = normalizeTokens(
        {
          input: op.input ?? op.inputTokens,
          output: op.output ?? op.outputTokens,
          cacheRead: op.cacheRead ?? op.cacheReadTokens ?? 0,
          cacheWrite: op.cacheWrite ?? op.cacheWriteTokens ?? 0,
          reasoning: op.reasoning ?? op.reasoningTokens,
          total: op.totalTokens ?? op.total
        },
        'separate'
      )
      operationTotals.set(id, tokens.total)
      this.put(id, tokens, r.timestamp ?? r.createdAt ?? m.timestamp)
    }
    const aggregate = count(u.totalTokens ?? u.total)
    const known = sum([...operationTotals.values()])
    const gapId = `aggregate-gap:${text(u.operationId) || text(r.id)}`
    this.rows.delete(gapId)
    if (
      Array.isArray(u.operations) &&
      u.operations.length &&
      aggregate !== null &&
      known !== null &&
      aggregate > known
    ) {
      this.rows.set(
        gapId,
        usageRecord(
          this.client,
          this.session,
          gapId,
          {
            input: null,
            output: null,
            cacheRead: null,
            cacheWrite: null,
            reasoning: null,
            total: aggregate - known
          },
          { project: this.project, requests: null, partial: true }
        )
      )
    }
  }

  private workbuddy(r: Record<string, unknown>): void {
    this.session = text(r.sessionId) || this.session
    this.project = text(r.cwd) || this.project
    if (!['message', 'assistant', 'function_call'].includes(text(r.type))) return
    const p = object(r.providerData)
    const m = object(r.message)
    const u = object(p.usage ?? m.usage)
    if (!Object.keys(u).length) return
    this.model = text(p.model) || this.model
    const details = (value: unknown, key: string): unknown =>
      Array.isArray(value)
        ? value.reduce<number>((a, b) => a + (count(object(b)[key]) ?? 0), 0)
        : object(value)[key]
    this.put(
      text(r.id),
      normalizeTokens(
        {
          input: u.inputTokens ?? u.input_tokens,
          output: u.outputTokens ?? u.output_tokens,
          cacheRead:
            u.cacheReadInputTokens ??
            u.cache_read_input_tokens ??
            details(u.inputTokensDetails ?? u.input_tokens_details, 'cached_tokens'),
          cacheWrite: u.cacheCreationInputTokens ?? u.cache_creation_input_tokens,
          reasoning:
            u.reasoningTokens ??
            u.reasoning_tokens ??
            details(u.outputTokensDetails ?? u.output_tokens_details, 'reasoning_tokens'),
          total: u.totalTokens ?? u.total_tokens
        },
        'included',
        'included',
        false
      ),
      r.timestamp
    )
  }

  private dsh(r: Record<string, unknown>): void {
    if (r.type === 'session') {
      if (
        typeof r.version !== 'number' ||
        r.version < 0 ||
        r.version > 4 ||
        !text(r.id) ||
        (r.version >= 2 && typeof r.isSeeded !== 'boolean')
      ) {
        this.issues++
        return
      }
      this.dshHeaderValid = true
      this.session = text(r.id)
      this.project = text(r.cwd)
      this.parent = text(r.parentSession)
      this.seedCut = count(r.seedLength) ?? 0
      this.seeded = r.isSeeded === true
      this.seedConfirmed = !this.seeded
      return
    }
    if (!this.dshHeaderValid) return
    const d = object(r.data)
    if (r.type === 'session/end-seed' && d.inherited === true) {
      this.seedCut = count(r.seq) ?? Number.MAX_SAFE_INTEGER
      this.seedConfirmed = true
      this.rows.clear()
      return
    }
    if (r.type === 'request/header') {
      const c = object(object(d.header).config)
      this.model = text(c.model)
      return
    }
    if ((count(r.seq) ?? -1) < this.seedCut || (this.seeded && !this.seedConfirmed)) return
    const step = `${d.turn}:${d.step}`
    if (r.type === 'llm/retry-started') {
      if (this.lastAttempt === step) this.attempts.set(step, (this.attempts.get(step) ?? 0) + 1)
      this.lastAttempt = ''
      return
    }
    if (!['assistant/message', 'assistant/attempt', 'assistant/chunk'].includes(text(r.type)))
      return
    if (count(d.turn) === null || count(d.step) === null) {
      this.issues++
      return
    }
    let usage = d.usage
    const chunk = object(d.chunk)
    if (r.type === 'assistant/chunk') usage = chunk.type === 'usage' ? chunk.usage : undefined
    if (!usage && Array.isArray(d.stream)) {
      for (const s of d.stream) {
        const c = object(object(s).chunk)
        if (c.type === 'usage') usage = c.usage
      }
    }
    const u = object(usage)
    if (!Object.keys(u).length) return
    this.lastAttempt = step
    this.put(
      `${step}:${this.attempts.get(step) ?? 0}`,
      normalizeTokens(
        {
          input: u.inputTokens,
          output: u.outputTokens,
          cacheRead: u.cacheReadTokens ?? 0,
          cacheWrite: u.cacheWriteTokens ?? 0,
          reasoning: u.reasoningTokens
        },
        'separate'
      ),
      r.time
    )
  }

  private gemini(r: Record<string, unknown>): void {
    const patch = object(r.$set)
    this.session = text(r.sessionId ?? patch.sessionId) || this.session
    const dirs = r.directories ?? patch.directories
    if (Array.isArray(dirs)) this.project = text(dirs[0])
    if (typeof r.$rewindTo === 'string') {
      const ids = [...this.rows.keys()]
      const index = ids.indexOf(r.$rewindTo)
      for (const id of ids.slice(Math.max(0, index))) this.rows.delete(id)
      return
    }
    if (Array.isArray(patch.messages)) this.rows.clear()
    const messages = r.messages ?? patch.messages
    if (Array.isArray(messages)) for (const m of messages) this.geminiMessage(object(m))
    else this.geminiMessage(r)
  }

  private geminiMessage(r: Record<string, unknown>): void {
    if (r.type !== 'gemini') return
    const t = object(r.tokens)
    if (!Object.keys(t).length) return
    this.model = text(r.model)
    this.put(
      text(r.id),
      normalizeTokens(
        {
          input: t.input,
          output: t.output,
          cacheRead: t.cached,
          reasoning: t.thoughts,
          total: t.total
        },
        'included',
        'separate',
        false
      ),
      r.timestamp
    )
  }
}
