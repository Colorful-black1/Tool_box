import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { TRENDING_DISK_TTL_MS } from '../../../shared/github-trending'
import type { TrendingLanguage } from '../../../shared/github-trending'
import { TRENDING_CACHE_VERSION, TrendingCache, trendingCacheKey } from './cache'
import type { TrendingCacheEntry } from './cache'

const dirs: string[] = []

async function tempFile(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'toolbox-trending-'))
  dirs.push(dir)
  return join(dir, 'cache.json')
}

function entry(period: 'daily' | 'weekly' | 'monthly', fetchedAtMs: number): TrendingCacheEntry {
  return {
    period,
    language: null,
    source: 'trending',
    items: [],
    fetchedAtMs
  }
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('GitHub 热榜缓存', () => {
  it('写入后重新加载仍能读取', async () => {
    const file = await tempFile()
    const first = new TrendingCache(file, () => 1_000)
    await first.set(entry('daily', 1_000))

    const second = new TrendingCache(file, () => 1_000)
    expect(await second.get(trendingCacheKey('daily', null))).toMatchObject({
      period: 'daily',
      source: 'trending',
      fetchedAtMs: 1_000
    })
  })

  it('最多保留 60 条，淘汰最旧记录', async () => {
    const file = await tempFile()
    const cache = new TrendingCache(file)
    for (let index = 0; index < 61; index++) {
      const period = index % 3 === 0 ? 'daily' : index % 3 === 1 ? 'weekly' : 'monthly'
      const language = index === 0 ? null : (`lang-${index}` as unknown as TrendingLanguage)
      await cache.set({ ...entry(period, index), language })
    }

    const raw = JSON.parse(await readFile(file, 'utf8')) as { entries: unknown[] }
    expect(raw.entries).toHaveLength(60)
  })

  it('版本不符或损坏 JSON 时当作没有缓存', async () => {
    const file = await tempFile()
    await writeFile(file, JSON.stringify({ version: 99, entries: [] }), 'utf8')
    expect(await new TrendingCache(file).get(trendingCacheKey('daily', null))).toBeNull()

    await writeFile(file, '{bad json', 'utf8')
    expect(await new TrendingCache(file).get(trendingCacheKey('daily', null))).toBeNull()

    await writeFile(file, JSON.stringify({ version: TRENDING_CACHE_VERSION, entries: [] }), 'utf8')
    expect(await new TrendingCache(file).get(trendingCacheKey('daily', null))).toBeNull()
  })

  it('超过 7 天的条目不再返回', async () => {
    const file = await tempFile()
    const cache = new TrendingCache(file, () => TRENDING_DISK_TTL_MS + 1)
    await cache.set(entry('daily', 0))
    expect(await cache.get(trendingCacheKey('daily', null))).toBeNull()
  })
})
