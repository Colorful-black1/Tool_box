import { execFile } from 'node:child_process'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { PortProcessStopResult } from '../../shared/types'

/** 进程身份仅保留名称和创建时间，不保存路径、命令行或环境变量。 */
export interface ProcessIdentity {
  pid: number
  name: string
  createdAt: string
}

const STOP_MESSAGES: Record<PortProcessStopResult['status'], string> = {
  stopped: '进程已停止',
  gone: '进程已经退出',
  changed: '进程身份或端口归属已变化，未停止，请重新查询',
  protected: '系统关键进程或工具箱自身进程不允许停止',
  denied: '权限不足或无法核实进程身份，未停止；本工具不会自动提权',
  failed: '停止失败，请重新查询端口后重试',
  timeout: '执行超时，无法确认进程状态，请刷新确认，勿连续操作',
  expired: '端口快照已过期，请重新查询后再操作',
  busy: '正在停止另一个进程，请稍候'
}

export function portStopResult(status: PortProcessStopResult['status']): PortProcessStopResult {
  return { status, message: STOP_MESSAGES[status] }
}

export function processStopBlockedReason(
  pid: number,
  name: string,
  protectedPids: number[]
): string | undefined {
  if (pid <= 4 || pid === process.pid || pid === process.ppid || protectedPids.includes(pid))
    return STOP_MESSAGES.protected
  if (
    /^(system|idle|registry|secure system|memory compression|smss|csrss|wininit|winlogon|services|lsass|lsaiso|svchost|fontdrvhost)$/i.test(
      name
    )
  )
    return STOP_MESSAGES.protected
  return undefined
}

// 在同一个原生句柄上核对创建时间、名称、关键进程标记后终止，避免 PID 复用误杀。
// 目标通过环境中的 JSON 数据传入；脚本与命令参数固定，不插值用户输入。
const STOP_SCRIPT = `$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Text;
using System.Runtime.InteropServices;
public static class ToolboxPortStop {
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool GetProcessTimes(IntPtr handle, out long created, out long exited, out long kernel, out long user);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool IsProcessCritical(IntPtr handle, out bool critical);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern bool QueryFullProcessImageName(IntPtr handle, uint flags, StringBuilder name, ref uint size);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool TerminateProcess(IntPtr handle, uint exitCode);
  [DllImport("kernel32.dll")]
  static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
  [DllImport("kernel32.dll")]
  static extern bool CloseHandle(IntPtr handle);
  public static string Stop(int pid, long expectedCreated, string expectedName) {
    IntPtr handle = OpenProcess(0x00101001, false, pid);
    if (handle == IntPtr.Zero) return Marshal.GetLastWin32Error() == 87 ? "gone" : "denied";
    try {
      long created, exited, kernel, user;
      if (!GetProcessTimes(handle, out created, out exited, out kernel, out user)) return "denied";
      if (created != expectedCreated) return "changed";
      if (WaitForSingleObject(handle, 0) == 0) return "gone";
      bool critical;
      if (!IsProcessCritical(handle, out critical)) return "denied";
      if (critical) return "protected";
      StringBuilder name = new StringBuilder(32768);
      uint size = (uint)name.Capacity;
      if (!QueryFullProcessImageName(handle, 0, name, ref size)) return "denied";
      if (!String.Equals(Path.GetFileNameWithoutExtension(name.ToString()), expectedName, StringComparison.OrdinalIgnoreCase)) return "changed";
      if (!TerminateProcess(handle, 1)) return WaitForSingleObject(handle, 0) == 0 ? "gone" : "denied";
      return WaitForSingleObject(handle, 3000) == 0 ? "stopped" : "timeout";
    } finally { CloseHandle(handle); }
  }
}
'@
$target = $env:TOOLBOX_PORT_STOP_TARGET | ConvertFrom-Json
[ToolboxPortStop]::Stop([int]$target.pid, [long]$target.createdAt, [string]$target.name)`

/** 只终止目标进程，不终止进程树、不自动提权；不返回系统输出。 */
export async function stopWindowsProcess(target: ProcessIdentity): Promise<PortProcessStopResult> {
  if (process.platform !== 'win32') return portStopResult('failed')
  try {
    const { stdout } = await promisify(execFile)(
      join(
        process.env.SystemRoot ?? 'C:\\Windows',
        'System32',
        'WindowsPowerShell',
        'v1.0',
        'powershell.exe'
      ),
      [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-EncodedCommand',
        Buffer.from(STOP_SCRIPT, 'utf16le').toString('base64')
      ],
      {
        windowsHide: true,
        timeout: 15000,
        maxBuffer: 64 * 1024,
        encoding: 'utf8',
        env: { ...process.env, TOOLBOX_PORT_STOP_TARGET: JSON.stringify(target) }
      }
    )
    const status = stdout.trim()
    if (Object.hasOwn(STOP_MESSAGES, status))
      return portStopResult(status as PortProcessStopResult['status'])
  } catch (error) {
    // 超时可能发生在终止之后；不自动重试，避免用户把新进程当作原目标。
    return portStopResult(
      error && typeof error === 'object' && 'killed' in error && error.killed === true
        ? 'timeout'
        : 'failed'
    )
  }
  return portStopResult('failed')
}
