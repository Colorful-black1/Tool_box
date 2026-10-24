import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { USAGE_CACHE_VERSION, readUsageCache, writeUsageCache } from './cache'
import type { UsageCache } from './cache'
import { normalizeTokens, usageRecord } from './normalize'

const roots: string[] = []
async function temp(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'toolbox-usage-cache-'))
  roots.push(path)
  return path
}
afterEach(async () => {
  for (const path of roots.splice(0)) {
    const target = resolve(path)
    if (
      dirname(target) !== resolve(tmpdir()) ||
      !basename(target).startsWith('toolbox-usage-cache-')
    )
      throw new Error('拒绝清理非本用例临时目录')
    await rm(target, { recursive: true, force: true })
  }
})

const tokens = normalizeTokens({ input: 10, output: 5, cacheRead: 0, cacheWrite: 0 }, 'separate')

function fixture(): UsageCache {
  return {
    version: USAGE_CACHE_VERSION,
    scannedAt: 100,
    sources: [
      {
        client: 'codex',
        paths: ['/fixture'],
        custom: false,
        status: 'ready',
        detail: '已读取本地用量',
        records: 1,
        durationMs: 12
      }
    ],
    files: [
      {
        client: 'codex',
        path: '/fixture/session.jsonl',
        fingerprint: 'fingerprint',
        partial: false,
        records: [
          usageRecord('codex', 's', '1', tokens, {
            project: '/fixture',
            model: 'fixture',
            time: 100,
            cost: 0.25
          })
        ]
      }
    ]
  }
}

describe('统计缓存', () => {
  it('只写元数据，读取后记录与来源耗时保持一致', async () => {
    const path = await temp()
    const file = join(path, 'agent-usage-cache.json')
    expect(await writeUsageCache(file, fixture())).toBe(true)
    const loaded = await readUsageCache(file)
    expect(loaded?.scannedAt).toBe(100)
    expect(loaded?.sources[0].durationMs).toBe(12)
    expect(loaded?.files[0].records[0]).toMatchObject({
      id: '1',
      costUsd: 0.25,
      partial: false
    })
    expect(loaded?.files[0].records[0].tokens.total).toBe(15)
    expect(JSON.parse(await readFile(file, 'utf8'))).not.toHaveProperty('content')
  })
  it('版本不符或记录结构损坏时丢弃，不阻塞重新扫描', async () => {
    const path = await temp()
    const file = join(path, 'agent-usage-cache.json')
    await writeFile(file, JSON.stringify({ ...fixture(), version: 99 }))
    expect(await readUsageCache(file)).toBeNull()
    const broken = fixture()
    const record = broken.files[0].records[0] as unknown as Record<string, unknown>
    delete record.costUsd
    await writeFile(file, JSON.stringify(broken))
    const loaded = await readUsageCache(file)
    expect(loaded?.files).toHaveLength(0)
    expect(loaded?.sources).toHaveLength(1)
  })
  it('超过上限放弃写入，原文件保持不变', async () => {
    const path = await temp()
    const file = join(path, 'agent-usage-cache.json')
    await writeFile(file, 'previous')
    expect(await writeUsageCache(file, fixture(), 16)).toBe(false)
    expect(await readFile(file, 'utf8')).toBe('previous')
  })
})
