import { execFile } from 'node:child_process'
import { X509Certificate } from 'node:crypto'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { CertificateView, PortProcessView, PortSnapshot } from '../../shared/types'
import { DeveloperToolError } from './developer-tools'

const executeFile = promisify(execFile)
const PROCESS_SCRIPT = `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = 'Stop'
ConvertTo-Json -Compress -InputObject @(Get-Process | Select-Object Id, ProcessName)`

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

function processMap(text: string): Map<number, string> {
  const parsed: unknown = JSON.parse(text.replace(/^\uFEFF/, ''))
  if (!Array.isArray(parsed)) throw new Error('Invalid process snapshot')
  const result = new Map<number, string>()
  for (const row of parsed) {
    if (!row || typeof row !== 'object') continue
    const value = row as Record<string, unknown>
    if (
      typeof value.Id === 'number' &&
      Number.isSafeInteger(value.Id) &&
      value.Id >= 0 &&
      typeof value.ProcessName === 'string' &&
      value.ProcessName.length <= 260
    )
      result.set(value.Id, value.ProcessName)
  }
  return result
}

let pendingSnapshot: Promise<PortSnapshot> | null = null

/** 固定系统路径、固定参数、无 shell；合并并发请求，不接收用户提供的命令。 */
export function listPortProcesses(): Promise<PortSnapshot> {
  if (pendingSnapshot) return pendingSnapshot
  pendingSnapshot = readWindowsPorts().finally(() => {
    pendingSnapshot = null
  })
  return pendingSnapshot
}

async function readWindowsPorts(): Promise<PortSnapshot> {
  if (process.platform !== 'win32') throw new DeveloperToolError('端口与进程查询目前仅支持 Windows')
  const system32 = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32')
  const options = {
    windowsHide: true,
    timeout: 12000,
    maxBuffer: 2 * 1024 * 1024,
    encoding: 'utf8' as const
  }
  const [ports, names] = await Promise.allSettled([
    executeFile(join(system32, 'netstat.exe'), ['-ano'], options),
    executeFile(
      join(system32, 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', PROCESS_SCRIPT],
      options
    )
  ])
  if (ports.status === 'rejected')
    throw new DeveloperToolError('无法读取端口占用，系统命令失败或超时，请稍后重试')
  let processes = new Map<number, string>()
  let processNamesAvailable = false
  if (names.status === 'fulfilled') {
    try {
      processes = processMap(names.value.stdout)
      processNamesAvailable = true
    } catch {
      /* 名称快照失败不丢弃端口与 PID，返回显式降级标记。 */
    }
  }
  const entries = parseNetstat(ports.value.stdout, processes)
  return {
    entries: entries.slice(0, 1000),
    total: entries.length,
    capturedAt: new Date().toISOString(),
    processNamesAvailable
  }
}
