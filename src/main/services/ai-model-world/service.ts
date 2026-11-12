import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

import { AI_WORLD_CACHE_TTL_MS } from '../../../shared/ai-model-world'
import type { AiWorldQuery, AiWorldResult, AiWorldSnapshot } from '../../../shared/ai-model-world'
import type { FetchLike } from '../github-trending/fetch'
import { collectNativeSnapshot } from './native'
import { NativeSourceError } from './native/http'

/** 快照读取失败的用户可读错误；不携带原始响应正文。 */
export class AiWorldError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'AiWorldError'
  }
}

const CACHE_VERSION = 2
const MAX_SNAPSHOT_BYTES = 32 * 1024 * 1024
const FIXED_SOURCE_URLS = [
  'https://models.dev',
  'https://epoch.ai/benchmarks',
  'https://livebench.ai',
  'https://huggingface.co'
]

export type AiWorldCollector = (fetchImpl: FetchLike, now: Date) => Promise<AiWorldSnapshot>

interface AiWorldCacheFile {
  version: number
  fetchedAtMs: number
  snapshot: AiWorldSnapshot
}

export interface AiWorldServiceOptions {
  fetchImpl?: FetchLike
  cacheFile: string
  now?: () => number
  /** 单测注入；生产环境使用原生采集器。 */
  collect?: AiWorldCollector
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requireArray(value: unknown, label: string, min: number, max: number): unknown[] {
  if (!Array.isArray(value) || value.length < min || value.length > max)
    throw new AiWorldError(`${label}格式不正确`)
  return value
}

/** 只做防止页面崩溃的结构校验；未知的可选字段按缺省值降级。 */
function parseSnapshot(value: unknown): AiWorldSnapshot {
  if (!isRecord(value)) throw new AiWorldError('快照不是对象')
  if (typeof value.generatedAt !== 'string' || Number.isNaN(Date.parse(value.generatedAt)))
    throw new AiWorldError('快照缺少有效的生成时间')
  const models = requireArray(value.models, '模型列表', 1, 5000)
  const vendors = requireArray(value.vendors, '厂商列表', 1, 500)
  if (!isRecord(value.sources)) throw new AiWorldError('快照缺少数据源状态')

  for (const raw of models) {
    if (!isRecord(raw)) throw new AiWorldError('模型记录格式不正确')
    for (const key of ['id', 'slug', 'name', 'vendorId']) {
      if (typeof raw[key] !== 'string' || !raw[key]) throw new AiWorldError('模型缺少必要字段')
    }
    for (const key of ['benchmarks', 'pricing', 'modalities', 'capabilities', 'params']) {
      if (!isRecord(raw[key])) throw new AiWorldError('模型属性格式不正确')
    }
    const modalities = raw.modalities
    if (
      !isRecord(modalities) ||
      !Array.isArray(modalities.input) ||
      !Array.isArray(modalities.output)
    )
      throw new AiWorldError('模型模态格式不正确')
    if (!Array.isArray(raw.coding)) throw new AiWorldError('模型属性格式不正确')
    if (raw.scores !== undefined && !Array.isArray(raw.scores))
      throw new AiWorldError('模型成绩格式不正确')
  }
  for (const raw of vendors) {
    if (!isRecord(raw) || typeof raw.id !== 'string' || typeof raw.name !== 'string')
      throw new AiWorldError('厂商记录格式不正确')
    if (raw.continent !== 'east' && raw.continent !== 'west')
      throw new AiWorldError('厂商地区格式不正确')
  }
  return value as unknown as AiWorldSnapshot
}

/** 原生快照的采集、缓存、来源白名单与旧缓存降级。 */
export class AiWorldService {
  private readonly fetchImpl: FetchLike
  private readonly cacheFile: string
  private readonly now: () => number
  private readonly collect: AiWorldCollector
  private readonly cache = new Map<string, AiWorldCacheFile>()
  private readonly knownUrls = new Set<string>(FIXED_SOURCE_URLS)
  private pending: Promise<AiWorldResult> | null = null

  constructor(options: AiWorldServiceOptions) {
    this.fetchImpl = options.fetchImpl ?? ((input, init) => globalThis.fetch(input, init))
    this.cacheFile = options.cacheFile
    this.now = options.now ?? Date.now
    this.collect = options.collect ?? collectNativeSnapshot
  }

  async get(query: AiWorldQuery = {}): Promise<AiWorldResult> {
    if (query.allowStale) {
      const cached = this.readCache()
      if (cached)
        return this.resultOf(
          cached,
          'cache',
          this.now() - cached.fetchedAtMs > AI_WORLD_CACHE_TTL_MS
        )
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

  isKnownSource(url: string): boolean {
    return this.knownUrls.has(url)
  }

  private async load(force: boolean): Promise<AiWorldResult> {
    const cached = this.readCache()
    if (cached && !force && this.now() - cached.fetchedAtMs <= AI_WORLD_CACHE_TTL_MS)
      return this.resultOf(cached, 'cache', false)

    try {
      const snapshot = await this.collect(this.fetchImpl, new Date(this.now()))
      this.remember(snapshot)
      const entry: AiWorldCacheFile = {
        version: CACHE_VERSION,
        fetchedAtMs: this.now(),
        snapshot
      }
      this.writeCache(entry)
      console.info('[AiModelWorld] 原生快照更新', {
        models: snapshot.models.length,
        vendors: snapshot.vendors.length,
        epoch: snapshot.sources['epoch.ai']?.ok !== false
      })
      return this.resultOf(entry, 'network', false)
    } catch (error) {
      const message =
        error instanceof NativeSourceError || error instanceof AiWorldError
          ? error.message
          : '网络请求失败'
      console.warn('[AiModelWorld] 原生采集失败', { message })
      if (cached) return this.resultOf(cached, 'cache', true)
      throw new AiWorldError('AI 模型数据读取失败，请检查网络或代理后重试', { cause: error })
    }
  }

  private readCache(): AiWorldCacheFile | null {
    const cached = this.cache.get(this.cacheFile)
    if (cached) return cached
    if (!existsSync(this.cacheFile)) return null
    try {
      const parsed = JSON.parse(readFileSync(this.cacheFile, 'utf8')) as unknown
      if (!isRecord(parsed) || parsed.version !== CACHE_VERSION) return null
      if (typeof parsed.fetchedAtMs !== 'number') return null
      const snapshot = parseSnapshot(parsed.snapshot)
      const entry = { version: CACHE_VERSION, fetchedAtMs: parsed.fetchedAtMs, snapshot }
      this.cache.set(this.cacheFile, entry)
      this.remember(snapshot)
      return entry
    } catch {
      return null
    }
  }

  private writeCache(entry: AiWorldCacheFile): void {
    const text = JSON.stringify(entry)
    if (Buffer.byteLength(text, 'utf8') > MAX_SNAPSHOT_BYTES)
      throw new AiWorldError('原生快照超过缓存大小上限')
    mkdirSync(dirname(this.cacheFile), { recursive: true })
    const temp = `${this.cacheFile}.tmp`
    writeFileSync(temp, text, 'utf8')
    renameSync(temp, this.cacheFile)
    this.cache.set(this.cacheFile, entry)
  }

  private remember(snapshot: AiWorldSnapshot): void {
    for (const model of snapshot.models) {
      for (const score of [...(model.coding ?? []), ...(model.scores ?? [])]) {
        if (score.sourceUrl?.startsWith('https://')) this.knownUrls.add(score.sourceUrl)
      }
    }
    for (const vendor of snapshot.vendors) {
      if (vendor.homepage?.startsWith('https://')) this.knownUrls.add(vendor.homepage)
    }
  }

  private resultOf(
    entry: AiWorldCacheFile,
    source: 'network' | 'cache',
    stale: boolean
  ): AiWorldResult {
    const epochOk = entry.snapshot.sources['epoch.ai']?.ok !== false
    const warnings: string[] = []
    if (stale) warnings.push('正在显示上次缓存，后台会继续尝试更新')
    if (!epochOk) warnings.push('Epoch AI 评测数据暂不可用，当前只显示模型基础信息')
    return {
      snapshot: entry.snapshot,
      fetchedAtMs: entry.fetchedAtMs,
      source,
      stale,
      warning: warnings.length ? warnings.join('；') : null
    }
  }
}
