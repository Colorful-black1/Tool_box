import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import {
  TRENDING_DISK_TTL_MS,
  findTrendingLanguage,
  findTrendingPeriod
} from '../../../shared/github-trending'
import type {
  TrendingLanguage,
  TrendingPeriod,
  TrendingRepo,
  TrendingSource
} from '../../../shared/github-trending'

export const TRENDING_CACHE_VERSION = 1
const MAX_ENTRIES = 60
const MAX_CACHE_BYTES = 2 * 1024 * 1024

export interface TrendingCacheEntry {
  period: TrendingPeriod
  language: TrendingLanguage | null
  source: TrendingSource
  items: TrendingRepo[]
  fetchedAtMs: number
}

interface StoredEntry extends TrendingCacheEntry {
  key: string
}

interface StoredCache {
  version: number
  entries: StoredEntry[]
}

/** 一个周期 + 一种语言共用一份缓存；空语言用空串占位。 */
export function trendingCacheKey(
  period: TrendingPeriod,
  language: TrendingLanguage | null
): string {
  return `${period}|${language ?? ''}`
}

/**
 * 热门榜单缓存：内存 Map + 可选 JSON 文件。
 *
 * 文件只是加速和断网兜底：读取失败、版本不符、条目损坏都静默丢弃，
 * 不能让缓存问题挡住页面。写入先写临时文件再 rename，避免半截 JSON。
 */
export class TrendingCache {
  private readonly entries = new Map<string, TrendingCacheEntry>()
  private readonly ready: Promise<void>

  constructor(
    private readonly filePath: string | null,
    private readonly now: () => number = Date.now
  ) {
    this.ready = this.load()
  }

  async get(key: string): Promise<TrendingCacheEntry | null> {
    await this.ready
    const entry = this.entries.get(key)
    if (!entry) return null
    if (this.now() - entry.fetchedAtMs > TRENDING_DISK_TTL_MS) {
      this.entries.delete(key)
      return null
    }
    return entry
  }

  async set(entry: TrendingCacheEntry): Promise<void> {
    await this.ready
    this.entries.set(trendingCacheKey(entry.period, entry.language), entry)
    this.prune()
    await this.persist()
  }

  private async load(): Promise<void> {
    if (!this.filePath) return
    try {
      const raw = await readFile(this.filePath, 'utf8')
      if (raw.length > MAX_CACHE_BYTES) return
      const parsed = JSON.parse(raw) as unknown
      if (!isObject(parsed) || parsed.version !== TRENDING_CACHE_VERSION) return
      if (!Array.isArray(parsed.entries)) return
      for (const value of parsed.entries) {
        const stored = readStoredEntry(value)
        if (stored) this.entries.set(stored.key, entryOf(stored))
      }
      this.prune()
    } catch {
      // 文件缺失、被占用、损坏都视为没有缓存，不影响在线抓取。
    }
  }

  private async persist(): Promise<void> {
    if (!this.filePath) return
    const payload: StoredCache = {
      version: TRENDING_CACHE_VERSION,
      entries: [...this.entries.entries()].map(([key, entry]) => ({ key, ...entry }))
    }
    const text = JSON.stringify(payload)
    if (Buffer.byteLength(text, 'utf8') > MAX_CACHE_BYTES) {
      console.warn('[GithubTrending] 缓存超过上限，本次不写入')
      return
    }
    try {
      await mkdir(dirname(this.filePath), { recursive: true })
      const temp = `${this.filePath}.tmp`
      await writeFile(temp, text, { encoding: 'utf8', mode: 0o600 })
      await rename(temp, this.filePath)
    } catch (error) {
      // 缓存写入失败只影响下次冷启动速度，不影响本次结果。
      console.warn('[GithubTrending] 缓存写入失败', {
        error: error instanceof Error ? error.name : 'unknown'
      })
    }
  }

  private prune(): void {
    const ordered = [...this.entries.entries()].sort(
      (left, right) => right[1].fetchedAtMs - left[1].fetchedAtMs
    )
    for (const [key] of ordered.slice(MAX_ENTRIES)) this.entries.delete(key)
  }
}

function readStoredEntry(value: unknown): StoredEntry | null {
  if (!isObject(value) || typeof value.key !== 'string') return null
  const period = findTrendingPeriod(value.period)?.value
  if (!period) return null
  const language = value.language === null ? null : findTrendingLanguage(value.language)
  if (value.language !== null && language === null) return null
  const source = value.source === 'trending' || value.source === 'search' ? value.source : null
  if (!source || !Array.isArray(value.items)) return null
  if (typeof value.fetchedAtMs !== 'number' || !Number.isFinite(value.fetchedAtMs)) return null

  const items: TrendingRepo[] = []
  for (const item of value.items) {
    const repo = readRepo(item)
    if (!repo) return null
    items.push(repo)
  }
  return {
    key: value.key,
    period,
    language,
    source,
    items,
    fetchedAtMs: value.fetchedAtMs
  }
}

function readRepo(value: unknown): TrendingRepo | null {
  if (!isObject(value)) return null
  if (
    typeof value.rank !== 'number' ||
    typeof value.fullName !== 'string' ||
    typeof value.url !== 'string' ||
    typeof value.description !== 'string' ||
    typeof value.language !== 'string' ||
    (value.languageColor !== null &&
      (typeof value.languageColor !== 'string' ||
        !/^#[0-9a-f]{3}$|^#[0-9a-f]{6}$/i.test(value.languageColor))) ||
    typeof value.stars !== 'number' ||
    typeof value.forks !== 'number' ||
    (value.periodStars !== null && typeof value.periodStars !== 'number')
  ) {
    return null
  }
  return {
    rank: value.rank,
    fullName: value.fullName,
    url: value.url,
    description: value.description,
    language: value.language,
    languageColor: value.languageColor,
    stars: value.stars,
    forks: value.forks,
    periodStars: value.periodStars
  }
}

function entryOf(stored: StoredEntry): TrendingCacheEntry {
  return {
    period: stored.period,
    language: stored.language,
    source: stored.source,
    items: stored.items,
    fetchedAtMs: stored.fetchedAtMs
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
