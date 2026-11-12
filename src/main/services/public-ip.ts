import { isIP } from 'node:net'

import type { PublicIpEntry, PublicIpView } from '../../shared/types'
import type { FetchLike } from './github-trending/fetch'

/** 公网查询失败的用户可读错误；不携带第三方响应正文。 */
export class PublicIpError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'PublicIpError'
  }
}

type PublicIpFamily = 'IPv4' | 'IPv6'

interface PublicIpProvider {
  name: string
  url: string
  parse: (body: string) => string | null
}

const REQUEST_TIMEOUT_MS = 5_000
const MAX_BODY_CHARS = 4_096

function normalizeIp(value: string): string | null {
  const address = value.trim().replace(/^\[|\]$/g, '')
  return isIP(address) ? address : null
}

/** 只读取 JSON 的 ip 字段，避免把响应里的其他数字误当成地址。 */
function parseJsonIp(body: string): string | null {
  try {
    const value: unknown = JSON.parse(body)
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null
    const ip = (value as Record<string, unknown>).ip
    return typeof ip === 'string' ? normalizeIp(ip) : null
  } catch {
    return null
  }
}

/** icanhazip / ident.me 这类服务直接返回单个地址。 */
function parsePlainIp(body: string): string | null {
  return normalizeIp(body)
}

/** IPIP.net 返回「当前 IP：x.x.x.x 来自于：…」，只取地址部分。 */
function parseIpipText(body: string): string | null {
  const match = body.match(/当前\s*IP\s*[：:]\s*([0-9a-fA-F:.]+)/i)
  return match ? normalizeIp(match[1]) : null
}

/**
 * IPv4 / IPv6 分开查询，避免双栈网络只返回 IPv6 而看不到 IPv4。
 *
 * 两个协议各按顺序尝试服务，单协议内串行，避免一次点击把地址同时暴露给多个第三方；
 * 服务失败时只记录协议、服务名和简短原因，不记录响应正文或查询结果。
 */
const PROVIDERS: Record<PublicIpFamily, readonly PublicIpProvider[]> = {
  IPv4: [
    { name: 'icanhazip', url: 'https://ipv4.icanhazip.com', parse: parsePlainIp },
    { name: 'ident.me', url: 'https://v4.ident.me', parse: parsePlainIp },
    { name: 'IPIP.net', url: 'https://myip.ipip.net', parse: parseIpipText }
  ],
  IPv6: [
    { name: 'icanhazip', url: 'https://ipv6.icanhazip.com', parse: parsePlainIp },
    { name: 'ident.me', url: 'https://v6.ident.me', parse: parsePlainIp },
    { name: 'ipify', url: 'https://api6.ipify.org?format=json', parse: parseJsonIp }
  ]
}

export interface PublicIpResolverOptions {
  /** 注入 fetch 便于单测；生产环境由主进程传入 Electron net.fetch。 */
  fetchImpl?: FetchLike
  now?: () => number
}

export class PublicIpResolver {
  private readonly fetchImpl: FetchLike
  private readonly now: () => number
  private pending: Promise<PublicIpView> | null = null

  constructor(options: PublicIpResolverOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? ((input, init) => globalThis.fetch(input, init))
    this.now = options.now ?? Date.now
  }

  /** 同一时间的重复点击复用同一次查询，避免连续请求多个第三方服务。 */
  async get(): Promise<PublicIpView> {
    if (this.pending) return this.pending
    const run = this.lookup()
    this.pending = run
    try {
      return await run
    } finally {
      if (this.pending === run) this.pending = null
    }
  }

  private async lookup(): Promise<PublicIpView> {
    const [ipv4, ipv6] = await Promise.all([this.lookupFamily('IPv4'), this.lookupFamily('IPv6')])
    if (!ipv4 && !ipv6) throw new PublicIpError('公网 IP 查询失败，请检查网络或代理后重试')
    return { ipv4, ipv6, checkedAt: new Date(this.now()).toISOString() }
  }

  private async lookupFamily(family: PublicIpFamily): Promise<PublicIpEntry | null> {
    const expected = family === 'IPv4' ? 4 : 6
    for (const provider of PROVIDERS[family]) {
      try {
        const address = await this.fetchProvider(provider)
        if (isIP(address) !== expected) throw new PublicIpError(`第三方服务未返回 ${family} 地址`)
        return { address, family, source: provider.name }
      } catch (error) {
        console.warn('[PublicIp] 查询失败，尝试下一个服务', {
          family,
          provider: provider.name,
          error: error instanceof PublicIpError ? error.message : '网络请求失败'
        })
      }
    }
    return null
  }

  private async fetchProvider(provider: PublicIpProvider): Promise<string> {
    const response = await this.fetchImpl(provider.url, {
      headers: {
        Accept: 'application/json, text/plain;q=0.9, */*;q=0.8',
        'User-Agent': 'ToolBox/0.3.0'
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    })
    if (!response.ok) throw new PublicIpError(`第三方服务暂时不可用（HTTP ${response.status}）`)
    const body = await response.text()
    if (body.length > MAX_BODY_CHARS) throw new PublicIpError('第三方服务返回内容过长')
    const address = provider.parse(body)
    if (!address) throw new PublicIpError('第三方服务返回内容无法识别')
    return address
  }
}
