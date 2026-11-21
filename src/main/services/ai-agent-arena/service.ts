import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

import { AI_AGENT_ARENA_SOURCES, AI_AGENT_ARENA_TTL_MS } from '../../../shared/ai-agent-arena'
import type {
  AiAgentArenaBoard,
  AiAgentArenaQuery,
  AiAgentArenaResult,
  AiAgentArenaSnapshot,
  AiAgentArenaSourceId,
  AiAgentArenaSourceState
} from '../../../shared/ai-agent-arena'
import type { FetchLike } from '../github-trending/fetch'
import { AiAgentArenaError } from './errors'
import { fetchCodeAgentBench } from './sources/codeagentbench'
import { fetchFrontierHarness } from './sources/frontierharness'
import { fetchTerminalBench } from './sources/terminal-bench'

const CACHE_VERSION = 1
const MAX_CACHE_BYTES = 16 * 1024 * 1024
const RETRY_DELAY_MS = 5 * 60 * 1000
const SOURCE_IDS = AI_AGENT_ARENA_SOURCES.map((source) => source.id)

interface CachedSource {
  fetchedAtMs: number
  checkedAtMs: number
  retryAtMs: number
  etag: string | null
  lastModified: string | null
  board: AiAgentArenaBoard
}

interface CacheFile {
  version: number
  sources: Partial<Record<AiAgentArenaSourceId, CachedSource>>
}

interface SourceFailure {
  id: AiAgentArenaSourceId
  message: string
}

type SourceFetcher = (
  fetchImpl: FetchLike,
  cache: { etag: string | null; lastModified: string | null }
) => Promise<{
  notModified: boolean
  board: AiAgentArenaBoard | null
  etag: string | null
  lastModified: string | null
}>

const FETCHERS: Record<AiAgentArenaSourceId, SourceFetcher> = {
  codeagentbench: fetchCodeAgentBench,
  'terminal-bench': fetchTerminalBench,
  frontierharness: fetchFrontierHarness
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isBoard(value: unknown): value is AiAgentArenaBoard {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    SOURCE_IDS.includes(value.id as AiAgentArenaSourceId) &&
    typeof value.name === 'string' &&
    Array.isArray(value.entries) &&
    Array.isArray(value.columns) &&
    typeof value.sourceUrl === 'string'
  )
}

function isCachedSource(value: unknown): value is CachedSource {
  return (
    isRecord(value) &&
    typeof value.fetchedAtMs === 'number' &&
    typeof value.checkedAtMs === 'number' &&
    typeof value.retryAtMs === 'number' &&
    isBoard(value.board)
  )
}

export interface AiAgentArenaServiceOptions {
  fetchImpl?: FetchLike
  cacheFile: string
  now?: () => number
}

/** 三个来源独立缓存、独立 TTL；一个来源失败不丢弃其它榜。 */
export class AiAgentArenaService {
  private readonly fetchImpl: FetchLike
  private readonly cacheFile: string
  private readonly now: () => number
  private cache: CacheFile | null
  private pending: Promise<AiAgentArenaResult> | null = null

  constructor(options: AiAgentArenaServiceOptions) {
    this.fetchImpl = options.fetchImpl ?? ((input, init) => globalThis.fetch(input, init))
    this.cacheFile = options.cacheFile
    this.now = options.now ?? Date.now
    this.cache = this.readCache()
  }

  async get(query: AiAgentArenaQuery = {}): Promise<AiAgentArenaResult> {
    if (query.allowStale && this.cache) {
      return this.resultOf(this.cache, 'cache', this.isStale(this.cache), [])
    }
    if (this.pending) return this.pending
    const run = this.load(query.force === true)
    this.pending = run
    try {
      return await run
    } finally {
      if (this.pending === run) this.pending = null
    }
  }

  private async load(force: boolean): Promise<AiAgentArenaResult> {
    const now = this.now()
    const cache: CacheFile = this.cache ?? { version: CACHE_VERSION, sources: {} }
    const due = SOURCE_IDS.filter((id) => {
      if (force) return true
      const source = cache.sources[id]
      if (!source) return true
      if (source.retryAtMs && source.retryAtMs > now) return false
      return now - source.checkedAtMs >= AI_AGENT_ARENA_TTL_MS[id]
    })
    if (!due.length) return this.resultOf(cache, 'cache', false, [])

    const failures: SourceFailure[] = []
    const results = await Promise.allSettled(
      due.map(async (id) => {
        const previous = cache.sources[id]
        const result = await FETCHERS[id](this.fetchImpl, {
          etag: previous?.etag ?? null,
          lastModified: previous?.lastModified ?? null
        })
        return { id, result }
      })
    )

    for (const [index, settled] of results.entries()) {
      const id = due[index]
      const previous = cache.sources[id]
      if (settled.status === 'rejected') {
        const message =
          settled.reason instanceof AiAgentArenaError
            ? settled.reason.message
            : '来源更新失败，请稍后重试'
        failures.push({ id, message })
        if (previous) {
          cache.sources[id] = {
            ...previous,
            checkedAtMs: now,
            retryAtMs: now + RETRY_DELAY_MS
          }
        }
        continue
      }
      const { result } = settled.value
      if (result.notModified) {
        if (previous) {
          cache.sources[id] = {
            ...previous,
            checkedAtMs: now,
            retryAtMs: 0,
            etag: result.etag ?? previous.etag,
            lastModified: result.lastModified ?? previous.lastModified
          }
        }
        continue
      }
      if (!result.board) {
        failures.push({ id, message: '来源没有返回有效数据' })
        if (previous) {
          cache.sources[id] = {
            ...previous,
            checkedAtMs: now,
            retryAtMs: now + RETRY_DELAY_MS
          }
        }
        continue
      }
      cache.sources[id] = {
        fetchedAtMs: now,
        checkedAtMs: now,
        retryAtMs: 0,
        etag: result.etag,
        lastModified: result.lastModified,
        board: result.board
      }
    }

    this.cache = cache
    this.writeCache(cache)
    const hasBoard = SOURCE_IDS.some((id) => Boolean(cache.sources[id]))
    if (!hasBoard) {
      throw new AiAgentArenaError('Agent 排行数据读取失败，请检查网络或代理后重试')
    }
    const failuresWithCache = failures.filter((failure) => Boolean(cache.sources[failure.id]))
    console.info('[AiAgentArena] 快照更新', {
      boards: SOURCE_IDS.filter((id) => Boolean(cache.sources[id])).length,
      entries: SOURCE_IDS.reduce(
        (total, id) => total + (cache.sources[id]?.board.entries.length ?? 0),
        0
      ),
      failed: failures.map((failure) => failure.id)
    })
    return this.resultOf(
      cache,
      'network',
      failuresWithCache.length > 0,
      failures
    )
  }

  private readCache(): CacheFile | null {
    if (!existsSync(this.cacheFile)) return null
    try {
      const parsed = JSON.parse(readFileSync(this.cacheFile, 'utf8')) as unknown
      if (!isRecord(parsed) || parsed.version !== CACHE_VERSION || !isRecord(parsed.sources))
        return null
      const sources: Partial<Record<AiAgentArenaSourceId, CachedSource>> = {}
      for (const id of SOURCE_IDS) {
        const value = parsed.sources[id]
        if (isCachedSource(value) && value.board.id === id) sources[id] = value
      }
      return Object.keys(sources).length ? { version: CACHE_VERSION, sources } : null
    } catch {
      // 缓存损坏时忽略旧文件，下一次成功采集会原子覆盖。
      return null
    }
  }

  private writeCache(cache: CacheFile): void {
    const text = JSON.stringify(cache)
    if (Buffer.byteLength(text, 'utf8') > MAX_CACHE_BYTES)
      throw new AiAgentArenaError('Agent 排行缓存超过大小上限')
    mkdirSync(dirname(this.cacheFile), { recursive: true })
    const temp = `${this.cacheFile}.tmp`
    writeFileSync(temp, text, 'utf8')
    renameSync(temp, this.cacheFile)
  }

  private isStale(cache: CacheFile): boolean {
    const now = this.now()
    return SOURCE_IDS.some((id) => {
      const source = cache.sources[id]
      if (!source) return true
      return now - source.checkedAtMs >= AI_AGENT_ARENA_TTL_MS[id]
    })
  }

  private resultOf(
    cache: CacheFile,
    source: 'network' | 'cache',
    stale: boolean,
    failures: readonly SourceFailure[]
  ): AiAgentArenaResult {
    const now = this.now()
    const sources = {} as Record<AiAgentArenaSourceId, AiAgentArenaSourceState>
    const boards: AiAgentArenaBoard[] = []
    const warnings: string[] = []
    for (const meta of AI_AGENT_ARENA_SOURCES) {
      const cached = cache.sources[meta.id]
      const failure = failures.find((item) => item.id === meta.id)
      if (cached) {
        boards.push(cached.board)
        sources[meta.id] = {
          ok: !failure,
          fetchedAt: new Date(cached.fetchedAtMs).toISOString(),
          checkedAt: new Date(cached.checkedAtMs).toISOString(),
          ...(failure
            ? { note: `${failure.message}，显示上次缓存` }
            : cached.retryAtMs > now
              ? { note: '上次更新失败，稍后重试' }
              : {})
        }
        if (failure) warnings.push(`${meta.label} 更新失败，显示上次缓存`)
      } else {
        sources[meta.id] = {
          ok: false,
          fetchedAt: null,
          checkedAt: new Date(now).toISOString(),
          note: failure?.message ?? '暂无数据'
        }
        if (failure) warnings.push(`${meta.label} 暂不可用`)
      }
    }
    if (stale) warnings.push('正在显示上次缓存，后台会继续尝试更新')
    const snapshot: AiAgentArenaSnapshot = {
      generatedAt: new Date(now).toISOString(),
      sources,
      boards
    }
    return {
      snapshot,
      fetchedAtMs: now,
      source,
      stale,
      warning: warnings.length ? warnings.join('；') : null
    }
  }
}
