import { describe, expect, it } from 'vitest'

import { UnsupportedTextEncodingError } from '../../data/text-decoder'
import { readPickedTextFile } from './password-file'

/** 造一个只实现本模块所需三个成员的文件对象，避免测试依赖 expo-file-system */
function fakeFile(content: string | Uint8Array, size = -1): {
  name: string
  size: number
  arrayBuffer(): Promise<ArrayBuffer>
} {
  const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content
  return {
    name: 'passwords.txt',
    // size 默认取真实字节数；显式传 0 可模拟「provider 拿不到大小」
    size: size < 0 ? bytes.length : size,
    arrayBuffer: async () => bytes.buffer as ArrayBuffer
  }
}

describe('readPickedTextFile', () => {
  it('UTF-8 文件读出文本', async () => {
    const text = await readPickedTextFile(fakeFile('网站名：GitHub\n密码：hunter2'))
    expect(text).toBe('网站名：GitHub\n密码：hunter2')
  })

  it('UTF-8 BOM 被剥掉，不进正文', async () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('密码：hunter2')])
    const text = await readPickedTextFile(fakeFile(bytes))
    expect(text).toBe('密码：hunter2')
  })

  it('UTF-16LE 文件同样能读', async () => {
    // 'A' = 0x41 0x00，小端
    const bytes = new Uint8Array([0xff, 0xfe, 0x41, 0x00])
    expect(await readPickedTextFile(fakeFile(bytes))).toBe('A')
  })

  it('空文件报错而不是返回空串', async () => {
    await expect(readPickedTextFile(fakeFile(new Uint8Array(0)))).rejects.toThrow(/文件为空/)
  })

  // 与书籍导入同一条约束：GBK 静默兜底会产出满屏乱码，报错更好排查
  it('GBK 文件给编码错误，不静默兜底', async () => {
    const gbk = new Uint8Array([0xd6, 0xd0, 0xce, 0xc4])
    await expect(readPickedTextFile(fakeFile(gbk))).rejects.toThrow(UnsupportedTextEncodingError)
  })

  // 预检的价值：明显超限时不必把整个文件读进内存
  it('size 超限时直接拦下，不读 arrayBuffer', async () => {
    let read = false
    const file = {
      name: 'huge.txt',
      size: 40 * 1024 * 1024,
      arrayBuffer: async () => {
        read = true
        return new ArrayBuffer(0)
      }
    }
    await expect(readPickedTextFile(file)).rejects.toThrow(/超过 32MB 上限/)
    expect(read).toBe(false)
  })

  // 很多 SAF provider 对选中的文件报 size=0，此时预检必须放行，交给字节长度兜底
  it('size 为 0（provider 拿不到）时放行，交给字节长度判定', async () => {
    const text = await readPickedTextFile(fakeFile('密码：hunter2', 0))
    expect(text).toBe('密码：hunter2')
  })

  it('size 谎报为 0 但字节数超限时，仍被 decodeBookText 拦下', async () => {
    await expect(
      readPickedTextFile(fakeFile(new Uint8Array(33 * 1024 * 1024), 0))
    ).rejects.toThrow(/超过 32MB 上限/)
  })
})