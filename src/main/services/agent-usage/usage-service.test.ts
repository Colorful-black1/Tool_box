import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentUsageService } from './usage-service'
import { normalizeTokens, usageRecord } from './normalize'

const fake = vi.hoisted(() => ({ scan: vi.fn() }))
vi.mock('./scanner', () => ({
  UsageScanner: class {
    scan = fake.scan
    seed = vi.fn()
    snapshot = vi.fn(() => [])
  }
}))

beforeEach(() => {
  fake.scan.mockReset()
  fake.scan.mockImplementation(async (client, paths, custom) => ({
    source: { client, paths, custom, status: 'missing', detail: 'fixture', records: 0 },
    records: []
  }))
})
describe('刷新与来源设置协调', () => {
  it('并发刷新共用一次扫描，过滤命中内存缓存', async () => {
    const service = new AgentUsageService()
    await Promise.all([service.query({ refresh: true }), service.query({ refresh: true })])
    expect(fake.scan).toHaveBeenCalledTimes(14)
    await service.query({ client: 'pi' })
    expect(fake.scan).toHaveBeenCalledTimes(14)
  })
  it('设置写入失败不改变有效来源，恢复后可继续设置；并发选择不会相互覆盖', async () => {
    const save = vi
      .fn()
      .mockRejectedValueOnce(new Error('write failed'))
      .mockResolvedValue(undefined)
    const service = new AgentUsageService({}, save)
    await expect(service.chooseSource('pi', '/failed')).rejects.toThrow()
    await Promise.all([service.chooseSource('pi', '/pi'), service.chooseSource('kimi', '/kimi')])
    expect(save.mock.calls.at(-1)?.[0]).toEqual({ pi: '/pi', kimi: '/kimi' })
    const report = await service.query({})
    expect(report.sources.find((s) => s.client === 'pi')?.paths).toEqual(['/pi'])
    await service.chooseSource('pi', null)
    expect(save.mock.calls.at(-1)?.[0]).toEqual({ kimi: '/kimi' })
  })
  it('启动读取缓存并直接返回，刷新后回写', async () => {
    const record = usageRecord(
      'pi',
      's',
      '1',
      normalizeTokens({ input: 10, output: 5 }, 'included'),
      { project: '/cached', model: 'fixture', time: Date.now() }
    )
    const cache = {
      version: 1,
      scannedAt: Date.now(),
      sources: [
        {
          client: 'pi' as const,
          paths: ['/cached'],
          custom: false,
          status: 'ready' as const,
          detail: '已读取本地用量',
          records: 1,
          durationMs: 5
        }
      ],
      files: [
        {
          client: 'pi' as const,
          path: '/cached/a.jsonl',
          fingerprint: 'f',
          partial: false,
          records: [record]
        }
      ]
    }
    const save = vi.fn(async () => undefined)
    const service = new AgentUsageService({}, async () => undefined, {
      load: async () => cache,
      save
    })
    const report = await service.query({})
    expect(fake.scan).not.toHaveBeenCalled()
    expect(report.tokens.total).toBe(15)
    expect(report.sources[0].paths).toEqual(['/cached'])
    await service.query({ refresh: true })
    expect(fake.scan).toHaveBeenCalledTimes(14)
    expect(save).toHaveBeenCalled()
  })
  it('单来源重扫只扫描该来源', async () => {
    const service = new AgentUsageService()
    await service.query({ client: 'pi', refresh: true })
    expect(fake.scan).toHaveBeenCalledTimes(1)
  })
})
