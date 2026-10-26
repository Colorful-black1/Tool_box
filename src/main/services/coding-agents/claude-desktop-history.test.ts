import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import { assertDesktopCodeIdle, readDesktopCodeSessions } from './claude-desktop-history'
import { claudeDesktopDataDirectory } from './claude-desktop-settings'

const mock = vi.hoisted(() => ({
  lstat: vi.fn(),
  readFile: vi.fn(),
  readdir: vi.fn(),
  execFile: vi.fn()
}))
vi.mock('node:fs/promises', () => mock)
vi.mock('node:child_process', () => ({ execFile: mock.execFile }))
vi.mock('node:os', () => ({ homedir: () => process.cwd() }))

const CLI_ID = '00000000-0000-4000-8000-000000000001'
const DESKTOP_ID = '00000000-0000-4000-8000-000000000002'
const entry = (name: string, kind: 'file' | 'directory' | 'link' = 'file') => ({
  name,
  isFile: () => kind === 'file',
  isDirectory: () => kind === 'directory',
  isSymbolicLink: () => kind === 'link'
})
function record(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    sessionId: DESKTOP_ID,
    cliSessionId: CLI_ID,
    cwd: process.cwd(),
    title: 'Desktop 原有编程任务',
    isArchived: false,
    completedTurns: 1,
    lastTurnEdgeAt: 20,
    latestUserFrameAt: 10,
    interruptedAwaitingPerson: null,
    ...patch
  }
}
beforeEach(() => {
  vi.resetAllMocks()
  vi.stubEnv('LOCALAPPDATA', process.cwd())
  mock.lstat.mockImplementation(async (path: string) =>
    path.endsWith('.json') ? { isFile: () => true, size: 1000 } : { isDirectory: () => true }
  )
  mock.readdir.mockResolvedValue([entry('session.json')])
  mock.readFile.mockResolvedValue(JSON.stringify(record()))
  mock.execFile.mockImplementation(
    (
      _file: string,
      _args: string[],
      _options: unknown,
      callback: (error: Error | null, stdout: string) => void
    ) => {
      callback(null, '"System","4","Services","0","1,024 K"')
    }
  )
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('Desktop Code 只读会话描述', () => {
  it('用 CLI ID 关联 SDK，仅读取当前项目；不返回原始权限、认证或桌面 ID', async () => {
    mock.readFile.mockResolvedValue(
      JSON.stringify(
        record({
          auth: 'fixture-private-token',
          permissionMode: 'bypassPermissions',
          spawnSeed: { command: 'unexpected' }
        })
      )
    )
    expect(await readDesktopCodeSessions(process.cwd())).toEqual([
      {
        id: CLI_ID,
        title: 'Desktop 原有编程任务',
        directory: process.cwd(),
        resumable: true
      }
    ])
    expect(mock.execFile).not.toHaveBeenCalled()
    mock.readFile.mockResolvedValue(JSON.stringify(record({ cwd: join(process.cwd(), 'other') })))
    expect(await readDesktopCodeSessions(process.cwd())).toEqual([])
  })
  it('按实际目录层级读取，支持 BOM，跳过符号链接与非 JSON 文件', async () => {
    const root = join(claudeDesktopDataDirectory(), 'claude-code-sessions')
    mock.readdir.mockImplementation(async (path: string) =>
      path === root
        ? [entry('account', 'directory'), entry('outside', 'link')]
        : path.endsWith('account')
          ? [entry('org', 'directory')]
          : [entry('session.json'), entry('linked.json', 'link'), entry('debug.log')]
    )
    mock.readFile.mockResolvedValue('\uFEFF' + JSON.stringify(record()))
    expect(await readDesktopCodeSessions(process.cwd())).toHaveLength(1)
    expect(mock.readFile).toHaveBeenCalledExactlyOnceWith(
      join(root, 'account', 'org', 'session.json'),
      'utf8'
    )
  })
  it('缺失根目录为空，权限失败明确报错，不读取其他数据根', async () => {
    mock.lstat.mockRejectedValueOnce(
      Object.assign(new Error('fixture-private'), { code: 'ENOENT' })
    )
    expect(await readDesktopCodeSessions(process.cwd())).toEqual([])
    mock.lstat.mockRejectedValueOnce(
      Object.assign(new Error('fixture-private'), { code: 'EACCES' })
    )
    await expect(readDesktopCodeSessions(process.cwd())).rejects.toThrow('无法读取')
    expect(mock.readFile).not.toHaveBeenCalled()
  })
  it('损坏或超大的单条文件不影响其他会话，日志不包含原文', async () => {
    mock.readdir.mockResolvedValue([entry('broken.json'), entry('large.json'), entry('valid.json')])
    mock.lstat.mockImplementation(async (path: string) =>
      path.endsWith('.json')
        ? { isFile: () => true, size: path.endsWith('large.json') ? 512 * 1024 + 1 : 1000 }
        : { isDirectory: () => true }
    )
    mock.readFile
      .mockResolvedValueOnce('invalid fixture-private-token')
      .mockResolvedValueOnce(JSON.stringify(record()))
    expect(await readDesktopCodeSessions(process.cwd())).toHaveLength(1)
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain(
      'fixture-private-token'
    )
    expect(mock.readFile).toHaveBeenCalledTimes(2)
  })
  it('无效 ID、相对路径、远程模式及元数据包装文件不被当成原生会话', async () => {
    for (const patch of [
      { cliSessionId: '../private' },
      { cliSessionId: DESKTOP_ID, cwd: 'relative' },
      { mode: 'ssh' },
      { mode: 'cloud' }
    ]) {
      mock.readFile.mockResolvedValueOnce(JSON.stringify(record(patch)))
      expect(await readDesktopCodeSessions(process.cwd())).toEqual([])
    }
    mock.readFile.mockResolvedValueOnce('{"version":1}')
    expect(await readDesktopCodeSessions(process.cwd())).toEqual([])
  })
  it('归档、等待处理、未完成及中断状态不放宽为可续接，重复描述也不放宽', async () => {
    for (const patch of [
      { isArchived: true },
      { isArchived: 'false' },
      { completedTurns: 0 },
      { interruptedAwaitingPerson: { type: 'approval' } },
      { latestUserFrameAt: 30 },
      { lastTurnEdgeAt: undefined }
    ]) {
      mock.readFile.mockResolvedValueOnce(JSON.stringify(record(patch)))
      expect((await readDesktopCodeSessions(process.cwd()))[0].resumable).toBe(false)
    }
    mock.readdir.mockResolvedValue([entry('a.json'), entry('b.json')])
    mock.readFile.mockResolvedValueOnce(JSON.stringify(record({ isArchived: true })))
    mock.readFile.mockResolvedValueOnce(JSON.stringify(record()))
    expect((await readDesktopCodeSessions(process.cwd()))[0].resumable).toBe(false)
  })
  it('遍历目录数量有上限，不递归跟随任意文件树', async () => {
    mock.readdir.mockResolvedValue(
      Array.from({ length: 257 }, (_, i) => entry(`dir-${i}`, 'directory'))
    )
    await expect(readDesktopCodeSessions(process.cwd())).rejects.toThrow('读取上限')
    expect(mock.readFile).not.toHaveBeenCalled()
  })
})

describe('原生续接的外部进程门', () => {
  it('使用固定系统命令且隐藏窗口；没有外部进程时可继续', async () => {
    await assertDesktopCodeIdle('win32')
    expect(mock.execFile).toHaveBeenCalledWith(
      expect.stringMatching(/tasklist\.exe$/),
      ['/FO', 'CSV', '/NH'],
      expect.objectContaining({ windowsHide: true, shell: false, timeout: 5000 }),
      expect.any(Function)
    )
  })
  it('进程名或内存列的系统文字编码不影响未运行 Claude 的判断', async () => {
    mock.execFile.mockImplementationOnce(
      (
        _file: string,
        _args: string[],
        _options: unknown,
        callback: (error: Error | null, stdout: string) => void
      ) =>
        callback(
          null,
          '"System","4","Services","0","1,024 K"\r\n"其他程序.exe","6","�","1","不适用"'
        )
    )
    await expect(assertDesktopCodeIdle('win32')).resolves.toBeUndefined()
  })
  it('存在外部进程、命令失败或未知输出均不接管；不输出进程原文', async () => {
    for (const [error, stdout] of [
      [null, '"Claude.exe","123","Console","1","10,000 K"'],
      [new Error('fixture-private-path'), ''],
      [null, ''],
      [null, 'unexpected fixture-private-path']
    ] as const) {
      mock.execFile.mockImplementationOnce(
        (
          _file: string,
          _args: string[],
          _options: unknown,
          callback: (error: Error | null, stdout: string) => void
        ) => callback(error, stdout)
      )
      await expect(assertDesktopCodeIdle('win32')).rejects.not.toThrow('fixture-private-path')
    }
    await expect(assertDesktopCodeIdle('linux')).rejects.toThrow('尚未验证')
  })
})
