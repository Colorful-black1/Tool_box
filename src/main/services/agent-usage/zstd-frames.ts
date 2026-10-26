import { zstdDecompress } from 'node:zlib'
import { promisify } from 'node:util'

const decompress = promisify(zstdDecompress)
const MAX_FRAME = 32 * 1024 * 1024

/** RFC 8878 帧边界；Node 原生解压只消费第一帧，DSH 的追加日志必须逐帧解码。 */
export function zstdFrameSize(buffer: Buffer): number | null {
  if (buffer.length < 4) return null
  const magic = buffer.readUInt32LE(0)
  if (magic >= 0x184d2a50 && magic <= 0x184d2a5f) {
    if (buffer.length < 8) return null
    const size = buffer.readUInt32LE(4) + 8
    if (size > MAX_FRAME) throw new Error('compressed frame limit')
    return buffer.length >= size ? size : null
  }
  if (magic !== 0xfd2fb528) throw new Error('unsupported compressed frame')
  if (buffer.length < 5) return null
  const descriptor = buffer[4]
  if (descriptor & 0x18) throw new Error('reserved compressed header')
  const single = Boolean(descriptor & 0x20)
  const contentFlag = descriptor >>> 6
  const dictBytes = [0, 1, 2, 4][descriptor & 3]
  const contentBytes = [single ? 1 : 0, 2, 4, 8][contentFlag]
  let offset = 5 + (single ? 0 : 1) + dictBytes + contentBytes
  if (buffer.length < offset) return null
  for (;;) {
    if (buffer.length < offset + 3) return null
    const header = buffer.readUIntLE(offset, 3)
    const type = (header >>> 1) & 3
    if (type === 3) throw new Error('reserved compressed block')
    offset += 3 + (type === 1 ? 1 : header >>> 3)
    if (offset > MAX_FRAME) throw new Error('compressed frame limit')
    if (buffer.length < offset) return null
    if (header & 1) {
      if (descriptor & 4) offset += 4
      return buffer.length >= offset ? offset : null
    }
  }
}

/** 只缓冲一个有上限的压缩帧；异步原生解压不会把多帧日志静默截成首帧。 */
export async function* decodeZstdFrames(
  source: AsyncIterable<Buffer>,
  allowIncompleteTail = false
): AsyncGenerator<Buffer> {
  let buffer = Buffer.alloc(0)
  for await (const chunk of source) {
    buffer = Buffer.concat([buffer, chunk])
    if (buffer.length > MAX_FRAME) throw new Error('compressed buffer limit')
    let size: number | null
    while ((size = zstdFrameSize(buffer)) !== null) {
      const frame = buffer.subarray(0, size)
      buffer = buffer.subarray(size)
      const magic = frame.readUInt32LE(0)
      if (magic !== 0xfd2fb528) continue
      yield await decompress(frame, { maxOutputLength: MAX_FRAME })
    }
  }
  // 活动日志允许末帧仍在追加；只输出完整帧，非法帧和解压错误仍照常抛出。
  if (buffer.length && !allowIncompleteTail) throw new Error('incomplete compressed frame')
}
