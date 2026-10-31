import { mkdtemp, mkdir, writeFile, stat, symlink } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { findDuplicateFiles } from './duplicate-finder'
import { createWindowsDirectoryAttributes } from './windows-directory-attributes'
import { formatFileSize, normalizeDisplayPath } from '../../../shared/file-tools'

describe('只读重复文件查找', () => {
  it.skipIf(process.platform !== 'win32')(
    '跳过Windows隐藏属性目录，普通子目录继续扫描',
    async () => {
      const root = await mkdtemp(join(tmpdir(), 'toolbox-duplicates-hidden-'))
      const hidden = join(root, 'windows-hidden')
      const visible = join(root, 'visible')
      await mkdir(hidden)
      await mkdir(visible)
      await writeFile(join(root, 'one'), 'same')
      await writeFile(join(hidden, 'ignored'), 'same')
      await writeFile(join(visible, 'two'), 'same')
      await promisify(execFile)('attrib.exe', ['+h', hidden], { windowsHide: true })
      const result = await findDuplicateFiles(
        root,
        'hidden-attributes',
        new AbortController().signal,
        () => {}
      )
      expect(result.phase).toBe('completed')
      expect(result.groups).toHaveLength(1)
      expect(result.groups[0].paths).toHaveLength(2)
      expect(result.groups[0].paths).not.toContain(join(hidden, 'ignored'))
      expect(result.warnings.some((warning) => warning.includes('接口不可用'))).toBe(false)
      const abort = new AbortController()
      const attributes = createWindowsDirectoryAttributes(abort.signal)
      const pending = attributes.read(visible)
      abort.abort()
      await expect(pending).rejects.toThrow()
      attributes.close()
    }
  )
  it('默认20000文件上限真实触发，并提示扫描范围', async () => {
    const root = await mkdtemp(join(tmpdir(), 'toolbox-duplicates-limit-'))
    for (let start = 0; start < 20_001; start += 250) {
      await Promise.all(
        Array.from({ length: Math.min(250, 20_001 - start) }, (_, index) =>
          writeFile(join(root, String(start + index)), '')
        )
      )
    }
    const result = await findDuplicateFiles(
      root,
      'default-limit',
      new AbortController().signal,
      () => {}
    )
    expect(result.files).toBe(20_000)
    expect(result.truncated).toBe(true)
    expect(result.warnings).toContain('仅扫描前 20000 个文件')
  }, 60_000)
  it('第13层目录不枚举，提示深度上限', async () => {
    const root = await mkdtemp(join(tmpdir(), 'toolbox-duplicates-depth-'))
    let directory = root
    for (let i = 0; i < 13; i += 1) {
      directory = join(directory, 'next')
      await mkdir(directory)
    }
    await writeFile(join(directory, 'excluded'), 'same')
    const result = await findDuplicateFiles(root, 'depth', new AbortController().signal, () => {})
    expect(result.files).toBe(0)
    expect(result.warnings).toContain('仅扫描深度 12 以内的目录')
  })
  it('按内容分组，同大小不同内容分开，零字节与构建目录跳过，mtime不变', async () => {
    const root = await mkdtemp(join(tmpdir(), 'toolbox-duplicates-'))
    await mkdir(join(root, 'nested'))
    await mkdir(join(root, 'node_modules'))
    const a = join(root, 'same.txt')
    await writeFile(a, 'AAAA')
    await writeFile(join(root, 'nested', 'renamed'), 'AAAA')
    await writeFile(join(root, 'different'), 'BBBB')
    await writeFile(join(root, 'zero'), '')
    await writeFile(join(root, 'node_modules', 'copy'), 'AAAA')
    const before = await stat(a)
    const result = await findDuplicateFiles(root, 'scan', new AbortController().signal, () => {})
    expect(result.phase).toBe('completed')
    expect(result.groups).toHaveLength(1)
    expect(result.groups[0]).toMatchObject({ size: 4, reclaimableBytes: 4 })
    expect(result.groups[0].paths).toHaveLength(2)
    expect((await stat(a)).mtimeMs).toBe(before.mtimeMs)
  })
  it('文件数和深度上限明确，取消后不继续哈希，可再次扫描', async () => {
    const root = await mkdtemp(join(tmpdir(), 'toolbox-duplicates-'))
    for (let i = 0; i < 6; i += 1) await writeFile(join(root, `${i}`), 'same')
    const capped = await findDuplicateFiles(root, 'cap', new AbortController().signal, () => {}, {
      maxFiles: 3,
      maxDepth: 1
    })
    expect(capped.files).toBe(3)
    expect(capped.truncated).toBe(true)
    expect(capped.warnings).toContain('仅扫描前 3 个文件')
    const abort = new AbortController()
    const cancelled = await findDuplicateFiles(root, 'cancel', abort.signal, (state) => {
      if (state.phase === 'hashing') abort.abort()
    })
    expect(cancelled.phase).toBe('cancelled')
    expect(cancelled.groups).toEqual([])
    const again = await findDuplicateFiles(root, 'again', new AbortController().signal, () => {})
    expect(again.groups[0].paths).toHaveLength(6)
  })
  it('不跟随联接与隐藏目录，纯格式化不暴露内容', async () => {
    const root = await mkdtemp(join(tmpdir(), 'toolbox-duplicates-'))
    const outside = await mkdtemp(join(tmpdir(), 'toolbox-duplicates-external-'))
    await writeFile(join(root, 'one'), 'same')
    await writeFile(join(outside, 'two'), 'same')
    await symlink(outside, join(root, 'link'), 'junction')
    await mkdir(join(root, '.hidden'))
    await writeFile(join(root, '.hidden', 'copy'), 'same')
    const result = await findDuplicateFiles(root, 'links', new AbortController().signal, () => {})
    expect(result.groups).toEqual([])
    expect(formatFileSize(1024)).toBe('1.00 KiB')
    expect(formatFileSize(-1)).toBe('未知')
    expect(normalizeDisplayPath('C:\\one\\two')).toBe('C:/one/two')
  })
})
