import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

import {
  AI_WORLD_AA_REFRESH_COOLDOWN_MS,
  AI_WORLD_AA_TTL_MS
} from '../../../shared/ai-world-aa'
import type {
  AiWorldAaModel,
  AiWorldAaQuery,
  AiWorldAaResult,
  AiWorldAaSnapshot,
  AiWorldAaSourceState
} from '../../../shared/ai-world-aa'
import type { FetchLike } from '../github-trending/fetch'
import { AiWorldAaError } from './errors'
import { fetchAiWorldAa } from './fetch'

const CACHE_VERSION = 1
const MAX_CACHE_BYTES = 8 * 1024 * 1024

interface CacheFile {
  version: number
  fetchedAtMs: number
  checkedAtMs: number
  quotaRemaining: number | null
  quotaResetAt: string | null
  error: string | null
  notice: string | null
  snapshot: AiWorldAaSnapshot
}

export interface AiWorldAaServiceOptions {
  fetchImpl?: FetchLike
  cacheFile: string
  getApiKey: () => string | null
  now?: () => number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isModel(value: unknown): value is AiWorldAaModel {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.slug === 'string' &&
    typeof value.name === 'string' &&
    typeof value.creator === 'string' &&
    isRecord(value.capabilityIndexes)
  )
}

function isCacheFile(value: unknown): value is CacheFile {
  if (!isRecord(value) || value.version !== CACHE_VERSION) return false
  if (typeof value.fetchedAtMs !== 'number' || typeof value.checkedAtMs !== 'number') return false
  if (value.error !== null && typeof value.error !== 'string') return false
  if (value.notice !== null && typeof value.notice !== 'string') return false
  if (value.quotaRemaining !== null && typeof value.quotaRemaining !== 'number') return false
  if (value.quotaResetAt !== null && typeof value.quotaResetAt !== 'string') return false
  const snapshot = value.snapshot
  return (
    isRecord(snapshot) &&
    typeof snapshot.generatedAt === 'string' &&
    Array.isArray(snapshot.models) &&
    snapshot.models.length > 0 &&
    snapshot.models.every(isModel)
  )
}

/** Artificial Analysis 免费档的独立缓存、TTL 与失败回退；不触碰 ECI 模型快照。 */
export class AiWorldAaService {
  private readonly fetchImpl: FetchLike
  private readonly cacheFile: string
  private readonly getApiKey: () => string | null
  private readonly now: () => number
  private cache: CacheFile | null
  private pending: Promise<AiWorldAaResult> | null = null

  constructor(options: AiWorldAaServiceOptions) {
    this.fetchImpl = options.fetchImpl ?? ((input, init) => globalThis.fetch(input, init))
    this.cacheFile = options.cacheFile
    this.getApiKey = options.getApiKey
    this.now = options.now ?? Date.now
    this.cache = this.readCache()
  }

  async get(query: AiWorldAaQuery = {}): Promise<AiWorldAaResult> {
    const apiKey = this.getApiKey()
    const cache = this.cache
    const now = this.now()

    if (!apiKey) {
      return {
        snapshot: null,
        fetchedAtMs: null,
        source: 'none',
        stale: true,
        state: {
          configured: false,
          ok: false,
          fetchedAt: null,
          checkedAt: new Date(now).toISOString(),
          quotaRemaining: null,
          quotaResetAt: null,
          note: '未配置 Artificial Analysis API Key'
        }
      }
    }
    if (query.allowStale && cache) return this.resultOf(cache, 'cache', this.isStale(cache, now))
    if (this.pending) return this.pending
    if (cache && !query.force && !this.isStale(cache, now))
      return this.resultOf(cache, 'cache', false)
    if (query.force && cache && now - cache.checkedAtMs < AI_WORLD_AA_REFRESH_COOLDOWN_MS) {
      return this.resultOf(cache, 'cache', this.isStale(cache, now), {
        note: '刷新过于频繁，请稍后再试'
      })
    }

    const run = this.load(apiKey, cache)
    this.pending = run
    try {
      return await run
    } finally {
      if (this.pending === run) this.pending = null
    }
  }

  private async load(apiKey: string, cached: CacheFile | null): Promise<AiWorldAaResult> {
    const now = this.now()
    try {
      const result = await fetchAiWorldAa(this.fetchImpl, apiKey)
      const snapshot: AiWorldAaSnapshot = {
        generatedAt: new Date(now).toISOString(),
        intelligenceIndexVersion: result.intelligenceIndexVersion,
        models: result.models
      }
      const entry: CacheFile = {
        version: CACHE_VERSION,
        fetchedAtMs: now,
        checkedAtMs: now,
        quotaRemaining: result.quota.remaining,
        quotaResetAt: result.quota.resetAt,
        error: null,
        notice: result.truncated
          ? `来源分页超过上限，仅展示前 ${result.models.length} 个模型`
          : null,
        snapshot
      }
      this.cache = entry
      this.writeCache(entry)
      console.info('[AiWorldAa] 快照更新', {
        models: snapshot.models.length,
        intelligenceIndexVersion: snapshot.intelligenceIndexVersion,
        quotaRemaining: result.quota.remaining
      })
      return this.resultOf(entry, 'network', false)
    } catch (error) {
      const message =
        error instanceof AiWorldAaError
          ? error.message
          : 'Artificial Analysis 数据读取失败，请稍后重试'
      console.warn('[AiWorldAa] 快照更新失败', { message })
      if (!cached) {
        return this.resultOf(null, 'none', true, {
          configured: true,
          ok: false,
          checkedAt: new Date(now).toISOString(),
          note: message
        })
      }
      const failed: CacheFile = {
        ...cached,
        checkedAtMs: now,
        error: `${message}，显示上次缓存`
      }
      this.cache = failed
      this.writeCache(failed)
      return this.resultOf(failed, 'cache', true, { configured: true })
    }
  }

  private readCache(): CacheFile | null {
    if (!existsSync(this.cacheFile)) return null
    try {
      const parsed = JSON.parse(readFileSync(this.cacheFile, 'utf8')) as unknown
      return isCacheFile(parsed) ? parsed : null
    } catch {
      // 缓存损坏时忽略旧文件，下一次成功采集会原子覆盖。
      return null
    }
  }

  private writeCache(cache: CacheFile): void {
    const text = JSON.stringify(cache)
    if (Buffer.byteLength(text, 'utf8') > MAX_CACHE_BYTES) {
      console.warn('[AiWorldAa] 缓存超过大小上限，本次未写入')
      return
    }
    try {
      mkdirSync(dirname(this.cacheFile), { recursive: true })
      const temp = `${this.cacheFile}.tmp`
      writeFileSync(temp, text, 'utf8')
      renameSync(temp, this.cacheFile)
    } catch (error) {
      console.warn('[AiWorldAa] 缓存写入失败', {
        message: error instanceof Error ? error.message : 'unknown'
      })
    }
  }

  private isStale(cache: CacheFile, now: number): boolean {
    return now - cache.checkedAtMs >= AI_WORLD_AA_TTL_MS
  }

  private resultOf(
    cache: CacheFile | null,
    source: AiWorldAaResult['source'],
    stale: boolean,
    override: Partial<AiWorldAaSourceState> = {}
  ): AiWorldAaResult {
    const now = this.now()
    const state: AiWorldAaSourceState = {
      configured: true,
      ok: cache ? cache.error == null : false,
      fetchedAt: cache ? new Date(cache.fetchedAtMs).toISOString() : null,
      checkedAt: cache ? new Date(cache.checkedAtMs).toISOString() : new Date(now).toISOString(),
      quotaRemaining: cache?.quotaRemaining ?? null,
      quotaResetAt: cache?.quotaResetAt ?? null,
      ...(cache?.error ? { note: cache.error } : cache?.notice ? { note: cache.notice } : {}),
      ...override
    }
    return {
      snapshot: cache?.snapshot ?? null,
      fetchedAtMs: cache?.fetchedAtMs ?? null,
      source,
      stale,
      state
    }
  }
}
