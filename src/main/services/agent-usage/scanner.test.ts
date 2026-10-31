import { mkdtemp, mkdir, writeFile, appendFile, rm, readFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { zstdCompressSync } from 'node:zlib'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { UsageScanner } from './scanner'
import { normalizeTokens, usageRecord } from './normalize'
import { readUsageDatabase } from './sqlite-source'

vi.mock('./sqlite-source', () => ({ readUsageDatabase: vi.fn() }))

const roots: string[] = []
async function root(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'toolbox-usage-fixture-'))
  roots.push(path)
  return path
}
afterEach(async () => {
  vi.resetAllMocks()
  for (const path of roots.splice(0)) {
    const target = resolve(path)
    if (
      dirname(target) !== resolve(tmpdir()) ||
      !basename(target).startsWith('toolbox-usage-fixture-')
    )
      throw new Error('拒绝清理非本用例临时目录')
    await rm(target, { recursive: true, force: true })
  }
})
const assistant = (id: string, output = 5): string =>
  JSON.stringify({
    type: 'assistant',
    sessionId: 's',
    message: { id, model: 'fixture', usage: { input_tokens: 10, output_tokens: output } }
  })

describe('来源文件生命周期', () => {
  const codexUsage = (ordinal: number): string =>
    JSON.stringify({
      timestamp: '2026-10-30T02:00:00Z',
      ordinal,
      type: 'token_usage_record',
      payload: {
        response_id: `response-${ordinal}`,
        usage: {
          input_tokens: 10,
          output_tokens: 5,
          cached_input_tokens: 0,
          reasoning_output_tokens: 0,
          total_tokens: 15
        }
      }
    })
  it.each(['compacted', 'response_item'])(
    'Codex 超大 %s 正文不阻止后续统计，刷新可替换旧缓存',
    async (type) => {
      const path = await root()
      const file = join(path, 'session.jsonl')
      const scanner = new UsageScanner()
      await writeFile(file, codexUsage(1) + '\n')
      expect((await scanner.scan('codex', [path])).records).toHaveLength(1)
      await appendFile(
        file,
        JSON.stringify({
          timestamp: '2026-10-30T02:00:00Z',
          ordinal: 2,
          type,
          payload: { text: 'x'.repeat(8 * 1024 * 1024 + 100) }
        }) +
          '\n' +
          codexUsage(3) +
          '\n'
      )
      const result = await scanner.scan('codex', [path])
      expect(result.source.status).toBe('ready')
      expect(result.records.map((row) => row.id)).toEqual(['response-1', 'response-3'])
      expect(result.records.every((row) => !row.partial)).toBe(true)
      expect((await scanner.scan('codex', [path])).records).toEqual(result.records)
      expect(scanner.snapshot()[0].partial).toBe(false)
    }
  )
  it('超大未知记录仍告警，但前后已提交用量不丢失，正文里的 type 不能伪装根头部', async () => {
    const path = await root()
    const file = join(path, 'session.jsonl')
    await writeFile(
      file,
      codexUsage(1) +
        '\n' +
        JSON.stringify({
          payload: { type: 'compacted', text: 'x'.repeat(8 * 1024 * 1024 + 100) },
          type: 'unknown'
        }) +
        '\n' +
        codexUsage(2) +
        '\n'
    )
    const result = await new UsageScanner().scan('codex', [path])
    expect(result.source.status).toBe('partial')
    expect(result.records).toHaveLength(2)
    expect(result.records.every((row) => row.partial)).toBe(true)
  })
  it('超大尾行未提交时不告警，完成后继续处理后面的用量', async () => {
    const path = await root()
    const file = join(path, 'session.jsonl')
    const scanner = new UsageScanner()
    const large = JSON.stringify({ type: 'unknown', payload: 'x'.repeat(8 * 1024 * 1024 + 100) })
    await writeFile(file, codexUsage(1) + '\n' + large)
    const pending = await scanner.scan('codex', [path])
    expect(pending.source.status).toBe('ready')
    expect(pending.records).toHaveLength(1)
    await appendFile(file, '\n' + codexUsage(2) + '\n')
    const complete = await scanner.scan('codex', [path])
    expect(complete.source.status).toBe('partial')
    expect(complete.records).toHaveLength(2)
  })
  it('重复刷新不累计；追加、截断与删除替换原快照', async () => {
    const path = await root()
    const file = join(path, 'session.jsonl')
    const scanner = new UsageScanner()
    await writeFile(file, assistant('a') + '\n')
    const first = await scanner.scan('claude', [path])
    expect(first.records).toHaveLength(1)
    expect((await scanner.scan('claude', [path])).records).toEqual(first.records)
    await appendFile(file, assistant('b') + '\n')
    expect((await scanner.scan('claude', [path])).records).toHaveLength(2)
    await writeFile(file, assistant('c') + '\n')
    expect((await scanner.scan('claude', [path])).records.map((r) => r.id)).toEqual(['c'])
    await rm(file)
    expect((await scanner.scan('claude', [path])).records).toHaveLength(0)
  })
  it('半行不计数也不告警，补完换行后刷新可读取且不重复计数', async () => {
    const path = await root()
    const file = join(path, 'session.jsonl')
    await writeFile(file, assistant('a') + '\n' + assistant('b'))
    const scanner = new UsageScanner()
    const first = await scanner.scan('claude', [path])
    expect(first.records).toHaveLength(1)
    expect(first.source.status).toBe('ready')
    expect((await scanner.scan('claude', [path])).records).toEqual(first.records)
    await appendFile(file, '\n')
    const completed = await scanner.scan('claude', [path])
    expect(completed.records).toHaveLength(2)
    expect(completed.source.status).toBe('ready')
    expect((await scanner.scan('claude', [path])).records).toEqual(completed.records)
  })
  it('首次扫描只有半行时保持零记录，补完之后才计入', async () => {
    const path = await root()
    const file = join(path, 'session.jsonl')
    const row = assistant('a')
    await writeFile(file, row.slice(0, -1))
    const scanner = new UsageScanner()
    const pending = await scanner.scan('claude', [path])
    expect(pending.records).toEqual([])
    expect(pending.source.status).toBe('empty')
    await appendFile(file, '}\n')
    const completed = await scanner.scan('claude', [path])
    expect(completed.records.map((r) => r.id)).toEqual(['a'])
    expect(completed.source.status).toBe('ready')
  })
  it.each([false, true])('扫描期间写入时保留确认值，解析抛错=%s', async (throws) => {
    const path = await root()
    const file = join(path, 'usage.db')
    await writeFile(file, 'fixture')
    const scanner = new UsageScanner()
    const first = usageRecord(
      'opencode',
      's',
      'a',
      normalizeTokens({ input: 10, output: 5, cacheRead: 0, total: 15 }, 'included')
    )
    const second = { ...first, id: 'b' }
    const read = vi.mocked(readUsageDatabase)
    read.mockResolvedValueOnce([first])
    const confirmed = await scanner.scan('opencode', [path])
    await appendFile(file, '-changed')
    read.mockImplementationOnce(async () => {
      await appendFile(file, '-writing')
      if (throws) throw new Error('fixture read failed during write')
      return [first, second]
    })
    const pending = await scanner.scan('opencode', [path])
    expect(pending.records).toEqual(confirmed.records)
    expect(pending.source.status).toBe('ready')
    expect(scanner.snapshot()[0].records).toEqual([first])
    read.mockResolvedValueOnce([first, second])
    const completed = await scanner.scan('opencode', [path])
    expect(completed.records).toEqual([first, second])
    expect(completed.source.status).toBe('ready')
    // 指纹未变化时复用刚确认的快照，不重复解析或累加。
    expect((await scanner.scan('opencode', [path])).records).toEqual(completed.records)
    expect(read).toHaveBeenCalledTimes(3)
  })
  it('文件稳定时的真实读取失败仍显示不完整并保留旧值', async () => {
    const path = await root()
    const file = join(path, 'usage.db')
    await writeFile(file, 'fixture')
    const scanner = new UsageScanner()
    const record = usageRecord(
      'opencode',
      's',
      'a',
      normalizeTokens({ input: 10, output: 5, cacheRead: 0, total: 15 }, 'included')
    )
    vi.mocked(readUsageDatabase).mockResolvedValueOnce([record])
    await scanner.scan('opencode', [path])
    await appendFile(file, '-changed')
    vi.mocked(readUsageDatabase).mockRejectedValueOnce(new Error('fixture read failed'))
    const failed = await scanner.scan('opencode', [path])
    expect(failed.source.status).toBe('partial')
    expect(failed.records).toEqual([{ ...record, partial: true }])
  })
  it('首次读取期间文件变化时不计入，下一次稳定后才提交', async () => {
    const path = await root()
    const file = join(path, 'usage.db')
    await writeFile(file, 'fixture')
    const scanner = new UsageScanner()
    const record = usageRecord(
      'opencode',
      's',
      'a',
      normalizeTokens({ input: 10, output: 5, cacheRead: 0, total: 15 }, 'included')
    )
    vi.mocked(readUsageDatabase).mockImplementationOnce(async () => {
      await appendFile(file, '-writing')
      return [record]
    })
    const pending = await scanner.scan('opencode', [path])
    expect(pending.records).toEqual([])
    expect(pending.source.status).toBe('empty')
    expect(scanner.snapshot()).toEqual([])
    vi.mocked(readUsageDatabase).mockResolvedValueOnce([record])
    expect((await scanner.scan('opencode', [path])).records).toEqual([record])
  })
  it('损坏记录和缺失路径分别显示，不泄露正文', async () => {
    const path = await root()
    await writeFile(join(path, 'session.jsonl'), '{PRIVATE_SENTINEL\n' + assistant('a') + '\n')
    const result = await new UsageScanner().scan('claude', [path])
    expect(result.source.status).toBe('partial')
    expect(JSON.stringify(result)).not.toContain('PRIVATE_SENTINEL')
    expect((await new UsageScanner().scan('claude', [join(path, 'absent')])).source.status).toBe(
      'missing'
    )
    await mkdir(join(path, 'empty'))
    expect((await new UsageScanner().scan('pi', [join(path, 'empty')])).source.status).toBe('empty')
  })
  it('DSH 原生压缩与明文镜像只选一份，优先最高代际', async () => {
    const path = await root()
    const dir = join(path, 'session')
    await mkdir(dir)
    const data =
      [
        { type: 'session', version: 4, id: 's', isSeeded: false },
        {
          type: 'assistant/message',
          seq: 1,
          time: 100,
          data: { turn: 1, step: 0, usage: { inputTokens: 10, outputTokens: 5 } }
        }
      ]
        .map((row) => JSON.stringify(row))
        .join('\n') + '\n'
    const compressed = zstdCompressSync(Buffer.from(data))
    await writeFile(join(dir, 'session.v4.jsonl.zstd'), compressed)
    const scanner = new UsageScanner()
    expect((await scanner.scan('dsh', [path])).records).toHaveLength(1)
    await writeFile(join(dir, 'session.v4.jsonl'), data)
    expect((await scanner.scan('dsh', [path])).records).toHaveLength(1)
    expect(await readFile(join(dir, 'session.v4.jsonl.zstd'))).toEqual(compressed)
  })
})
