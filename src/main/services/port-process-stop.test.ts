import { beforeEach, describe, expect, it, vi } from 'vitest'
import { listPortProcesses, stopPortProcess } from './developer-diagnostics'
import { portStopResult, processStopBlockedReason } from './windows-process-control'

const mock = vi.hoisted(() => ({ run: vi.fn(), stop: vi.fn(), ports: '' }))
vi.mock('node:child_process', () => ({
  execFile: Object.assign(vi.fn(), { [Symbol.for('nodejs.util.promisify.custom')]: mock.run })
}))
vi.mock('./windows-process-control', async (original) => ({
  ...(await original<typeof import('./windows-process-control')>()),
  stopWindowsProcess: mock.stop
}))

const pid = 500001
beforeEach(() => {
  vi.clearAllMocks()
  mock.ports = `TCP 127.0.0.1:54321 0.0.0.0:0 LISTENING ${pid}`
  mock.run.mockImplementation(async (file: string) => ({
    stdout: file.endsWith('netstat.exe')
      ? mock.ports
      : JSON.stringify([{ Id: pid, ProcessName: 'node', CreatedAt: '134000000000000000' }])
  }))
  mock.stop.mockResolvedValue(portStopResult('stopped'))
})

describe.skipIf(process.platform !== 'win32')('端口进程停止边界（系统执行全为桩）', () => {
  it('只接受已签发引用，校验端口后传入原始创建时间；引用不可重放', async () => {
    expect((await stopPortProcess('unknown', [])).status).toBe('expired')
    expect(mock.run).not.toHaveBeenCalled()
    const row = (await listPortProcesses()).entries[0]
    expect(row.stopToken).toBeTruthy()
    expect((await stopPortProcess(row.stopToken!, [])).status).toBe('stopped')
    expect(mock.stop).toHaveBeenCalledWith({ pid, name: 'node', createdAt: '134000000000000000' })
    expect((await stopPortProcess(row.stopToken!, [])).status).toBe('expired')
    expect(mock.stop).toHaveBeenCalledTimes(1)
  })
  it('端口易主后不终止进程；重新查询使旧引用失效', async () => {
    const row = (await listPortProcesses()).entries[0]
    mock.ports = mock.ports.replace(String(pid), String(pid + 1))
    expect((await stopPortProcess(row.stopToken!, [])).status).toBe('changed')
    expect(mock.stop).not.toHaveBeenCalled()
    mock.ports = mock.ports.replace(String(pid + 1), String(pid))
    const old = (await listPortProcesses()).entries[0]
    await listPortProcesses()
    expect((await stopPortProcess(old.stopToken!, [])).status).toBe('expired')
  })
  it('保护进程不签发引用；执行时再次检查保护名单', async () => {
    const row = (await listPortProcesses([pid])).entries[0]
    expect(row.stopToken).toBeUndefined()
    expect(row.stopBlockedReason).toContain('不允许停止')
    const next = (await listPortProcesses()).entries[0]
    expect((await stopPortProcess(next.stopToken!, [pid])).status).toBe('protected')
    expect(mock.stop).not.toHaveBeenCalled()
    expect(processStopBlockedReason(4, 'System', [])).toBeTruthy()
    expect(processStopBlockedReason(process.pid, 'toolbox', [])).toBeTruthy()
    expect(processStopBlockedReason(pid, 'svchost', [])).toBeTruthy()
  })
  it('超期引用不执行；权限不足保持明确结果，不自动重试', async () => {
    const row = (await listPortProcesses()).entries[0]
    const now = Date.now()
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now + 300_001)
    try {
      expect((await stopPortProcess(row.stopToken!, [])).status).toBe('expired')
      expect(mock.stop).not.toHaveBeenCalled()
    } finally {
      clock.mockRestore()
    }
    const next = (await listPortProcesses()).entries[0]
    mock.stop.mockResolvedValueOnce(portStopResult('denied'))
    expect((await stopPortProcess(next.stopToken!, [])).status).toBe('denied')
    expect(mock.stop).toHaveBeenCalledTimes(1)
  })
})
