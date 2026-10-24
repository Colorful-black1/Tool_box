import { zstdCompressSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { decodeZstdFrames, zstdFrameSize } from './zstd-frames'

async function* chunks(buffer: Buffer, size: number): AsyncGenerator<Buffer> {
  for (let i = 0; i < buffer.length; i += size) yield buffer.subarray(i, i + size)
}
async function decode(buffer: Buffer, size = 7): Promise<string> {
  const values: Buffer[] = []
  for await (const chunk of decodeZstdFrames(chunks(buffer, size))) values.push(chunk)
  return Buffer.concat(values).toString('utf8')
}
describe('追加式 Zstandard 日志', () => {
  it('多个帧与任意拆分边界均完整读取', async () => {
    const data = Buffer.concat(
      ['header\n', 'usage-a\n', 'usage-b\n'].map((s) => zstdCompressSync(Buffer.from(s)))
    )
    for (const size of [1, 7, 64, 1000])
      expect(await decode(data, size)).toBe('header\nusage-a\nusage-b\n')
  })
  it('跳过 skippable frame，截断帧明确失败而不假装读完', async () => {
    const skip = Buffer.alloc(11)
    skip.writeUInt32LE(0x184d2a50, 0)
    skip.writeUInt32LE(3, 4)
    const frame = zstdCompressSync(Buffer.from('usage\n'))
    expect(await decode(Buffer.concat([skip, frame]))).toBe('usage\n')
    await expect(decode(frame.subarray(0, frame.length - 1))).rejects.toThrow()
    expect(() => zstdFrameSize(Buffer.from('invalid'))).toThrow()
  })
})
