import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import { detectOpenCodeDesktop, detectOpenCodeExecutable } from './opencode-runtime'

const paths = vi.hoisted(() => ({ files: new Set<string>(), directories: new Set<string>() }))
vi.mock('node:fs/promises', () => ({
  realpath: vi.fn(),
  stat: vi.fn(async (path: string) => {
    if (!paths.files.has(path) && !paths.directories.has(path)) throw new Error('不存在')
    return {
      isFile: () => paths.files.has(path),
      isDirectory: () => paths.directories.has(path)
    }
  })
}))

const root = 'C:\\fixture\\Local'
const installation = (name: string): string => join(root, 'Programs', name)
const cli = (name: string): string => join(installation(name), 'resources', 'opencode-cli.exe')

beforeEach(() => {
  vi.stubEnv('LOCALAPPDATA', root)
  paths.files.clear()
  paths.directories.clear()
})
afterEach(() => vi.unstubAllEnvs())

describe.skipIf(process.platform !== 'win32')('OpenCode Windows 安装位置', () => {
  it('旧版本路径已被更新移除时自动定位 2.2.0 安装目录', async () => {
    paths.files.add(cli('ai.opencode.desktop'))
    expect(await detectOpenCodeExecutable(cli('@opencodedesktop'))).toBe(cli('ai.opencode.desktop'))
  })

  it('保留仍有效的手动选择，旧安装目录也继续可用', async () => {
    const custom = 'C:\\fixture\\custom\\opencode.exe'
    paths.files.add(custom)
    paths.files.add(cli('ai.opencode.desktop'))
    paths.files.add(cli('@opencodedesktop'))
    expect(await detectOpenCodeExecutable(custom)).toBe(custom)
    paths.files.delete(cli('ai.opencode.desktop'))
    expect(await detectOpenCodeExecutable()).toBe(cli('@opencodedesktop'))
  })

  it('残留的同名目录不算 CLI，也不扫描相对路径', async () => {
    paths.directories.add(cli('ai.opencode.desktop'))
    paths.files.add('opencode.exe')
    expect(await detectOpenCodeExecutable('opencode.exe')).toBeNull()
  })

  it('打开 Desktop 同时支持新旧安装位置', async () => {
    const current = join(installation('ai.opencode.desktop'), 'OpenCode.exe')
    const legacy = join(installation('@opencodedesktop'), 'OpenCode.exe')
    paths.files.add(current)
    paths.files.add(legacy)
    expect(await detectOpenCodeDesktop()).toBe(current)
    paths.files.delete(current)
    expect(await detectOpenCodeDesktop()).toBe(legacy)
  })
})
