import { execFile } from 'node:child_process'
import { randomUUID, X509Certificate } from 'node:crypto'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type {
  CertificateView,
  PortProcessView,
  PortSnapshot,
  PortProcessStopResult
} from '../../shared/types'
import { DeveloperToolError } from './developer-tools'
import { portStopResult, processStopBlockedReason, stopWindowsProcess } from './windows-process-control'
import type { ProcessIdentity } from './windows-process-control'

const executeFile = promisify(execFile)
const PROCESS_SCRIPT = `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = 'Stop'
ConvertTo-Json -Compress -InputObject @(Get-Process | ForEach-Object {
  $item = $_
  $created = $null
  try { $created = $item.StartTime.ToFileTimeUtc().ToString() } catch {
    # Protected processes may deny creation time; keep their name but disable stopping.
  }
  [PSCustomObject]@{ Id = $item.Id; ProcessName = $item.ProcessName; CreatedAt = $created }
})`
const SYSTEM32 = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32')
const COMMAND_OPTIONS = {
  windowsHide: true,
  timeout: 12000,
  maxBuffer: 2 * 1024 * 1024,
  encoding: 'utf8' as const
}

/** 只记住最近一次快照的前 1000 行，有效期五分钟，不落盘。 */
interface PortStopTarget {
  row: PortProcessView
  identity: ProcessIdentity
  expiresAt: number
}
const stopTargets = new Map<string, PortStopTarget>()
let stopping = false

/** 只接受证书 PEM 块或单张 DER 的 Base64；混入私钥、说明文字均拒绝。 */
export function inspectCertificates(text: string): CertificateView[] {
  if (!text.trim() || text.length > 131072) throw new DeveloperToolError('证书内容不能超过 128 KiB')
  if (/PRIVATE KEY/.test(text)) throw new DeveloperToolError('检测到私钥，请只提供公开证书')
  const pattern = /-----BEGIN CERTIFICATE-----([\s\S]*?)-----END CERTIFICATE-----/g
  const matches = [...text.matchAll(pattern)]
  if (matches.length > 10) throw new DeveloperToolError('一次最多查看 10 张证书')
  if (matches.length && text.replace(pattern, '').trim())
    throw new DeveloperToolError('证书文件包含其他内容，请仅保留证书块')
  const bodies = matches.length ? matches.map((match) => match[1]) : [text]
  try {
    return bodies.map((body) => {
      const encoded = body.replace(/\s/g, '')
      if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded))
        throw new Error('invalid')
      const der = Buffer.from(encoded, 'base64')
      const cert = new X509Certificate(der)
      if (!cert.raw.equals(der)) throw new Error('trailing content')
      const key = cert.publicKey
      const details = key.asymmetricKeyDetails
      return {
        subject: cert.subject,
        issuer: cert.issuer,
        subjectAltName: cert.subjectAltName ?? '',
        serialNumber: cert.serialNumber,
        validFrom: new Date(cert.validFrom).toISOString(),
        validTo: new Date(cert.validTo).toISOString(),
        fingerprint256: cert.fingerprint256,
        publicKey: [key.asymmetricKeyType, details?.modulusLength, details?.namedCurve]
          .filter(Boolean)
          .join(' / '),
        ca: cert.ca
      }
    })
  } catch {
    throw new DeveloperToolError('无法解析证书，请使用有效的 X.509 PEM 或 DER 文件')
  }
}

/** 解析系统快照的白名单字段，兼容 IPv6 的冒号及 UDP 无远端/状态列。 */
export function parseNetstat(text: string, processes: Map<number, string>): PortProcessView[] {
  const entries: PortProcessView[] = []
  const seen = new Set<string>()
  for (const line of text.split(/\r?\n/)) {
    const fields = line.trim().split(/\s+/)
    const protocol = fields[0]
    if (protocol !== 'TCP' && protocol !== 'UDP') continue
    if (fields.length !== (protocol === 'TCP' ? 5 : 4)) continue
    const endpoint = /^(.*):(\d+)$/.exec(fields[1])
    const pid = Number(fields.at(-1))
    if (!endpoint || !Number.isSafeInteger(pid) || pid < 0) continue
    const port = Number(endpoint[2])
    if (port < 0 || port > 65535) continue
    const key = fields.join('|')
    if (seen.has(key)) continue
    seen.add(key)
    entries.push({
      protocol,
      address: endpoint[1].replace(/^\[|\]$/g, ''),
      port,
      remote: protocol === 'TCP' ? fields[2] : '',
      state: protocol === 'TCP' ? fields[3] : 'BOUND',
      pid,
      processName: processes.get(pid) ?? (pid === 0 ? '系统 / 已退出' : '未知 / 已退出')
    })
  }
  return entries.sort(
    (a, b) =>
      Number(b.state === 'LISTENING') - Number(a.state === 'LISTENING') ||
      a.port - b.port ||
      a.protocol.localeCompare(b.protocol) ||
      a.pid - b.pid
  )
}

function processMap(text: string): Map<number, ProcessIdentity> {
  const parsed: unknown = JSON.parse(text.replace(/^\uFEFF/, ''))
  if (!Array.isArray(parsed)) throw new Error('Invalid process snapshot')
  const result = new Map<number, ProcessIdentity>()
  for (const row of parsed) {
    if (!row || typeof row !== 'object') continue
    const value = row as Record<string, unknown>
    if (
      typeof value.Id === 'number' &&
      Number.isSafeInteger(value.Id) &&
      value.Id >= 0 &&
      typeof value.ProcessName === 'string' &&
      value.ProcessName.length > 0 &&
      value.ProcessName.length <= 260
    )
      result.set(value.Id, {
        pid: value.Id,
        name: value.ProcessName,
        createdAt:
          typeof value.CreatedAt === 'string' && /^[1-9]\d{15,18}$/.test(value.CreatedAt)
            ? value.CreatedAt
            : ''
      })
  }
  return result
}

let pendingSnapshot: Promise<PortSnapshot> | null = null

/** 固定系统路径、固定参数、无 shell；合并并发请求，不接收用户提供的命令。 */
export function listPortProcesses(protectedPids = [process.pid, process.ppid]): Promise<PortSnapshot> {
  if (pendingSnapshot) return pendingSnapshot
  pendingSnapshot = readWindowsPorts(protectedPids).finally(() => {
    pendingSnapshot = null
  })
  return pendingSnapshot
}

async function readPortOutput(): Promise<string> {
  return (await executeFile(join(SYSTEM32, 'netstat.exe'), ['-ano'], COMMAND_OPTIONS)).stdout
}

async function readWindowsPorts(protectedPids: number[]): Promise<PortSnapshot> {
  if (process.platform !== 'win32') throw new DeveloperToolError('端口与进程查询目前仅支持 Windows')
  const [ports, names] = await Promise.allSettled([
    readPortOutput(),
    executeFile(
      join(SYSTEM32, 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', PROCESS_SCRIPT],
      COMMAND_OPTIONS
    )
  ])
  if (ports.status === 'rejected')
    throw new DeveloperToolError('无法读取端口占用，系统命令失败或超时，请稍后重试')
  let processes = new Map<number, ProcessIdentity>()
  let processNamesAvailable = false
  if (names.status === 'fulfilled') {
    try {
      processes = processMap(names.value.stdout)
      processNamesAvailable = true
    } catch {
      /* 名称快照失败不丢弃端口与 PID，返回显式降级标记。 */
    }
  }
  const entries = parseNetstat(
    ports.value,
    new Map([...processes].map(([pid, item]) => [pid, item.name]))
  )
  stopTargets.clear()
  const visible = entries.slice(0, 1000).map((row) => {
    const identity = processes.get(row.pid)
    const reason =
      processStopBlockedReason(row.pid, row.processName, protectedPids) ??
      (!identity?.createdAt ? '无法核实进程创建时间，请重新查询或使用系统工具' : undefined)
    if (reason || !identity) return { ...row, stopBlockedReason: reason }
    const stopToken = randomUUID()
    stopTargets.set(stopToken, { row, identity, expiresAt: Date.now() + 300_000 })
    return { ...row, stopToken }
  })
  return {
    entries: visible,
    total: entries.length,
    capturedAt: new Date().toISOString(),
    processNamesAvailable
  }
}

/** 只操作已签发引用；端口重新查询后再由原生句柄核实进程身份。 */
export async function stopPortProcess(
  token: string,
  protectedPids: number[]
): Promise<PortProcessStopResult> {
  if (stopping) return portStopResult('busy')
  const target = stopTargets.get(token)
  if (!target || target.expiresAt < Date.now()) return portStopResult('expired')
  stopTargets.delete(token)
  if (processStopBlockedReason(target.identity.pid, target.identity.name, protectedPids))
    return portStopResult('protected')
  stopping = true
  try {
    const current = parseNetstat(await readPortOutput(), new Map())
    const { row } = target
    if (
      !current.some(
        (item) =>
          item.pid === row.pid &&
          item.protocol === row.protocol &&
          item.address === row.address &&
          item.port === row.port
      )
    )
      return portStopResult('changed')
    const result = await stopWindowsProcess(target.identity)
    console.info('[PortProcess] 停止结果', { pid: row.pid, status: result.status })
    return result
  } catch {
    console.warn('[PortProcess] 停止前核对端口失败')
    return portStopResult('failed')
  } finally {
    stopping = false
  }
}
