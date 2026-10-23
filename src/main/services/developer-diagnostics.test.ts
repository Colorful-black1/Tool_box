import { describe, expect, it } from 'vitest'
import { rootCertificates } from 'node:tls'
import { X509Certificate } from 'node:crypto'
import { createServer } from 'node:net'
import { createSocket } from 'node:dgram'
import { inspectCertificates, listPortProcesses, parseNetstat } from './developer-diagnostics'
import { validateCertificateInput } from '../ipc/validation'

describe('公开证书查看', () => {
  it('支持真实公开根证书 PEM/DER 及证书链，结果仅包含允许的元数据', () => {
    const pem = rootCertificates[0]
    const certificate = new X509Certificate(pem)
    const result = inspectCertificates(pem)
    expect(result[0].subject).toBe(certificate.subject)
    expect(result[0].fingerprint256).toBe(certificate.fingerprint256)
    expect(result[0].ca).toBe(true)
    expect(inspectCertificates(certificate.raw.toString('base64'))).toEqual(result)
    expect(inspectCertificates(`${pem}\n${pem}`)).toHaveLength(2)
    expect(JSON.stringify(result)).not.toContain('BEGIN CERTIFICATE')
  })
  it('拒绝私钥、混合内容、伪 PEM、大文件、多证书和尾随 DER', () => {
    expect(() => inspectCertificates('-----BEGIN PRIVATE KEY-----')).toThrow('私钥')
    expect(() => inspectCertificates(`${rootCertificates[0]}\nother`)).toThrow('其他内容')
    expect(() =>
      inspectCertificates('-----BEGIN CERTIFICATE-----a-----END CERTIFICATE-----')
    ).toThrow('无法解析')
    expect(() => inspectCertificates(Array(11).fill(rootCertificates[0]).join('\n'))).toThrow(
      '10 张'
    )
    const der = new X509Certificate(rootCertificates[0]).raw
    expect(() =>
      inspectCertificates(Buffer.concat([der, Buffer.from('tail')]).toString('base64'))
    ).toThrow()
    expect(() => validateCertificateInput(' '.repeat(131073))).toThrow('128')
    expect(() => validateCertificateInput({})).toThrow()
    expect(() => validateCertificateInput('')).toThrow()
  })
})

describe('只读端口解析', () => {
  it.runIf(process.platform === 'win32')(
    '真实 Windows 快照识别本测试的 TCP / UDP 与进程名，并合并并发查询',
    async () => {
      const tcp = createServer()
      const udp = createSocket('udp4')
      try {
        await new Promise<void>((resolve, reject) => {
          tcp.once('error', reject)
          tcp.listen(0, '127.0.0.1', resolve)
        })
        await new Promise<void>((resolve, reject) => {
          udp.once('error', reject)
          udp.bind(0, '127.0.0.1', resolve)
        })
        const first = listPortProcesses()
        expect(listPortProcesses()).toBe(first)
        const snapshot = await first
        const address = tcp.address()
        expect(address && typeof address === 'object').toBe(true)
        const tcpPort = address && typeof address === 'object' ? address.port : -1
        expect(snapshot.entries).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              protocol: 'TCP',
              port: tcpPort,
              pid: process.pid,
              state: 'LISTENING'
            }),
            expect.objectContaining({ protocol: 'UDP', port: udp.address().port, pid: process.pid })
          ])
        )
        expect(snapshot.processNamesAvailable).toBe(true)
        expect(snapshot.entries.find((row) => row.pid === process.pid)?.processName).not.toBe(
          '未知 / 已退出'
        )
      } finally {
        if (tcp.listening) await new Promise<void>((resolve) => tcp.close(() => resolve()))
        udp.close()
      }
    },
    20000
  )
  it('IPv4、IPv6、UDP、监听排序、消失的 PID；不泄露命令行字段', () => {
    const rows = parseNetstat(
      `Active Connections\n TCP 127.0.0.1:5234 192.0.2.1:443 ESTABLISHED 10\n TCP [::]:8080 [::]:0 LISTENING 20\n UDP 0.0.0.0:5353 *:* 30\n TCP [::]:8080 [::]:0 LISTENING 20\n TCP nope invalid invalid invalid\n TCP 0.0.0.0:99999 0.0.0.0:0 LISTENING 40`,
      new Map([[20, 'java']])
    )
    expect(rows).toHaveLength(3)
    expect(rows[0]).toMatchObject({
      protocol: 'TCP',
      address: '::',
      port: 8080,
      pid: 20,
      processName: 'java',
      state: 'LISTENING'
    })
    expect(rows[2]).toMatchObject({
      protocol: 'UDP',
      port: 5353,
      state: 'BOUND',
      processName: '未知 / 已退出'
    })
    expect(Object.keys(rows[0])).toEqual([
      'protocol',
      'address',
      'port',
      'remote',
      'state',
      'pid',
      'processName'
    ])
  })
  it('非 Windows 返回明确的不支持提示', async () => {
    const platform = Object.getOwnPropertyDescriptor(process, 'platform')!
    Object.defineProperty(process, 'platform', { value: 'linux' })
    try {
      await expect(listPortProcesses()).rejects.toThrow('仅支持 Windows')
    } finally {
      Object.defineProperty(process, 'platform', platform)
    }
  })
})
