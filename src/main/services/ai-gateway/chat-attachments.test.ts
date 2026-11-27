import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { ChatImageProcessor } from './chat-attachments'
import {
  loadAttachmentContent,
  prepareChatAttachments,
  sanitizeAttachmentName
} from './chat-attachments'

const processor: ChatImageProcessor = {
  prepare: () => ({
    data: Buffer.from('jpeg-data'),
    mime: 'image/jpeg',
    width: 800,
    height: 600
  })
}

let root = ''

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'toolbox-chat-attachment-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

const PNG_PREFIX = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])

describe('prepareChatAttachments', () => {
  it('文本附件从源路径读取，并保留原始大小与 token 元数据', async () => {
    const path = join(root, 'notes.md')
    await writeFile(path, '你好，世界')
    const [attachment] = prepareChatAttachments([{ path }], processor)
    expect(attachment).toMatchObject({
      kind: 'text',
      name: 'notes.md',
      filePath: path,
      textContent: '你好，世界',
      textChars: 5,
      truncated: false
    })
    expect(attachment.textTokens).toBeGreaterThan(0)
    expect(attachment.sizeBytes).toBe(Buffer.byteLength('你好，世界'))
  })

  it('超过单文件字数时截断并标记', async () => {
    const path = join(root, 'long.txt')
    await writeFile(path, 'a'.repeat(20_005))
    const [attachment] = prepareChatAttachments([{ path }], processor)
    expect(attachment.textContent).toHaveLength(20_000)
    expect(attachment.textChars).toBe(20_000)
    expect(attachment.truncated).toBe(true)
  })

  it('文本附件合计超过 40,000 字时拒绝', async () => {
    const paths = ['a.txt', 'b.txt', 'c.txt']
    await writeFile(join(root, paths[0]), 'a'.repeat(20_000))
    await writeFile(join(root, paths[1]), 'b'.repeat(20_000))
    await writeFile(join(root, paths[2]), 'c')
    expect(() =>
      prepareChatAttachments(
        paths.map((name) => ({ path: join(root, name) })),
        processor
      )
    ).toThrow('40,000')
  })

  it('拒绝不支持的文本扩展名、二进制内容与空文件', async () => {
    const pdf = join(root, 'report.pdf')
    await writeFile(pdf, 'fake')
    expect(() => prepareChatAttachments([{ path: pdf }], processor)).toThrow('不支持的文件类型')

    const binary = join(root, 'binary.txt')
    await writeFile(binary, Buffer.from([0x61, 0x00, 0x62]))
    expect(() => prepareChatAttachments([{ path: binary }], processor)).toThrow('二进制')

    const empty = join(root, 'empty.txt')
    await writeFile(empty, '   ')
    expect(() => prepareChatAttachments([{ path: empty }], processor)).toThrow(
      '没有可读取的文本内容'
    )
  })

  it('图片按 magic bytes 校验并通过处理器读取尺寸', async () => {
    const path = join(root, 'chart.png')
    await writeFile(path, PNG_PREFIX)
    const [attachment] = prepareChatAttachments([{ path }], processor)
    expect(attachment).toMatchObject({
      kind: 'image',
      mime: 'image/jpeg',
      width: 800,
      height: 600,
      filePath: path,
      truncated: false
    })
    expect(attachment.imageData?.toString()).toBe('jpeg-data')
  })

  it('伪造图片扩展名但字节不是图片时拒绝', async () => {
    const path = join(root, 'fake.png')
    await writeFile(path, 'not an image')
    expect(() => prepareChatAttachments([{ path }], processor)).toThrow('无法解析')
  })

  it('拒绝相对路径、缺失文件、目录与超过数量上限', async () => {
    expect(() => prepareChatAttachments([{ path: 'notes.txt' }], processor)).toThrow('路径无效')
    expect(() => prepareChatAttachments([{ path: join(root, 'missing.txt') }], processor)).toThrow(
      '找不到附件'
    )
    const directory = join(root, 'folder')
    await mkdir(directory)
    expect(() => prepareChatAttachments([{ path: directory }], processor)).toThrow('不是文件')

    const path = join(root, 'a.txt')
    await writeFile(path, 'a')
    expect(() =>
      prepareChatAttachments([{ path }, { path }, { path }, { path }], processor)
    ).toThrow('最多 3 个')
  })

  it('文件名去掉路径与控制字符', () => {
    expect(sanitizeAttachmentName('..\\secret/\u0000report.txt')).toBe('.. secret report.txt')
  })
})

describe('loadAttachmentContent', () => {
  it('源文件删除后返回 missing，不抛异常', async () => {
    const path = join(root, 'gone.txt')
    await writeFile(path, '内容')
    expect(loadAttachmentContent(path, 'text', processor)).toMatchObject({ text: '内容' })
    await rm(path)
    expect(loadAttachmentContent(path, 'text', processor)).toEqual({ missing: true })
  })
})
