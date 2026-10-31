import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { createInterface } from 'node:readline'

// 固定程序仅读取目录属性；文件名以 JSON 行传入，绝不拼进 PowerShell 源码。
const SCRIPT = `
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
while ($null -ne ($line = [Console]::ReadLine())) {
  try {
    $path = ConvertFrom-Json -InputObject $line
    $flags = [System.IO.File]::GetAttributes($path)
    [Console]::WriteLine(([int]$flags).ToString())
  } catch { [Console]::WriteLine('unavailable') }
}
`

/** Node stat 不暴露 Windows 隐藏位；每次扫描复用一个系统只读属性查询进程。 */
export function createWindowsDirectoryAttributes(signal: AbortSignal): {
  read(path: string): Promise<number | null>
  close(): void
} {
  const executable = join(
    process.env.SystemRoot ?? 'C:\\Windows',
    'System32/WindowsPowerShell/v1.0/powershell.exe'
  )
  const child = spawn(
    executable,
    [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-EncodedCommand',
      Buffer.from(SCRIPT, 'utf16le').toString('base64')
    ],
    {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'ignore']
    }
  )
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity })
  const iterator = lines[Symbol.asyncIterator]()
  let closed = false
  let failure: Error | null = null
  child.on('error', () => {
    failure = new Error('Windows 目录属性接口不可用')
    lines.close()
  })
  // 子进程关闭与取消可能使尚在发送的 stdin 报 EPIPE；查询方通过结果结束处理。
  child.stdin.on('error', () => {
    failure = new Error('Windows 目录属性查询已结束')
  })
  const close = (): void => {
    if (closed) return
    closed = true
    signal.removeEventListener('abort', close)
    lines.close()
    child.stdin.destroy()
    child.kill()
  }
  signal.addEventListener('abort', close, { once: true })
  if (signal.aborted) close()
  return {
    async read(path): Promise<number | null> {
      signal.throwIfAborted()
      if (closed || failure) throw new Error('Windows 目录属性接口不可用')
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        child.stdin.write(JSON.stringify(path) + '\n')
        const line = await Promise.race([
          iterator.next(),
          new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => {
              close()
              reject(new Error('Windows 目录属性读取超时'))
            }, 5000)
          })
        ])
        signal.throwIfAborted()
        if (line.done) throw new Error('Windows 目录属性接口不可用')
        if (line.value === 'unavailable') return null
        if (!/^\d+$/.test(line.value)) throw new Error('Windows 目录属性响应无效')
        return Number(line.value)
      } finally {
        if (timer) clearTimeout(timer)
      }
    },
    close
  }
}
