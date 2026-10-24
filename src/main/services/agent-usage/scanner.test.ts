import { mkdtemp, mkdir, writeFile, appendFile, rm, readFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { zstdCompressSync } from 'node:zlib'
import { afterEach, describe, expect, it } from 'vitest'
import { UsageScanner } from './scanner'

const roots: string[] = []
async function root(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'toolbox-usage-fixture-'))
  roots.push(path)
  return path
}
afterEach(async () => {
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
  it('半行不计数，补完换行后刷新可读取', async () => {
    const path = await root()
    const file = join(path, 'session.jsonl')
    await writeFile(file, assistant('a') + '\n' + assistant('b'))
    const scanner = new UsageScanner()
    const first = await scanner.scan('claude', [path])
    expect(first.records).toHaveLength(1)
    expect(first.source.status).toBe('partial')
    await appendFile(file, '\n')
    expect((await scanner.scan('claude', [path])).records).toHaveLength(2)
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
