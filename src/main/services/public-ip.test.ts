import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { FetchLike } from './github-trending/fetch'
import { PublicIpResolver } from './public-ip'

describe('公网 IP 查询', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('分别返回 IPv4 与 IPv6、来源和查询时间', async () => {
    const fetchImpl = vi.fn(async (input: string) => {
      if (input.includes('ipv4.icanhazip')) return new Response('203.0.113.7\n')
      if (input.includes('ipv6.icanhazip')) return new Response('2001:db8::7\n')
      return new Response('', { status: 500 })
    })
    const resolver = new PublicIpResolver({
      fetchImpl: fetchImpl as unknown as FetchLike,
      now: () => 1_700_000_000_000
    })

    await expect(resolver.get()).resolves.toEqual({
      ipv4: { address: '203.0.113.7', family: 'IPv4', source: 'icanhazip' },
      ipv6: { address: '2001:db8::7', family: 'IPv6', source: 'icanhazip' },
      checkedAt: new Date(1_700_000_000_000).toISOString()
    })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('拒绝非法地址和错误协议，并分别回退到下一个服务', async () => {
    const fetchImpl = vi.fn(async (input: string) => {
      if (input.includes('ipv4.icanhazip')) return new Response('999.999.999.999', { status: 200 })
      if (input.includes('v4.ident.me')) return new Response('2001:db8::1', { status: 200 })
      if (input.includes('myip.ipip.net'))
        return new Response('当前 IP：198.51.100.9  来自于：合成地区', { status: 200 })
      if (input.includes('ipv6.icanhazip')) return new Response('203.0.113.9', { status: 200 })
      if (input.includes('v6.ident.me')) return new Response('2001:db8::9', { status: 200 })
      return new Response('', { status: 500 })
    })
    const resolver = new PublicIpResolver({ fetchImpl: fetchImpl as unknown as FetchLike })

    await expect(resolver.get()).resolves.toMatchObject({
      ipv4: { address: '198.51.100.9', family: 'IPv4', source: 'IPIP.net' },
      ipv6: { address: '2001:db8::9', family: 'IPv6', source: 'ident.me' }
    })
    expect(fetchImpl).toHaveBeenCalledTimes(5)
  })

  it('只检测到一种协议时仍返回结果，另一项为 null', async () => {
    const fetchImpl = vi.fn(async (input: string) => {
      if (input.includes('ipv4.icanhazip')) return new Response('203.0.113.11\n')
      return new Response('unavailable', { status: 503 })
    })
    const resolver = new PublicIpResolver({ fetchImpl: fetchImpl as unknown as FetchLike })

    await expect(resolver.get()).resolves.toMatchObject({
      ipv4: { address: '203.0.113.11', source: 'icanhazip' },
      ipv6: null
    })
    expect(fetchImpl).toHaveBeenCalledTimes(4)
  })

  it('全部服务失败时只返回可读错误，不泄漏响应正文', async () => {
    const fetchImpl = vi.fn(async () => new Response('synthetic-private-body', { status: 503 }))
    const resolver = new PublicIpResolver({ fetchImpl: fetchImpl as unknown as FetchLike })

    const error = await resolver.get().catch((reason: unknown) => reason)
    expect(error).toMatchObject({
      message: '公网 IP 查询失败，请检查网络或代理后重试'
    })
    expect(String(error)).not.toContain('synthetic-private-body')
    expect(fetchImpl).toHaveBeenCalledTimes(6)
  })

  it('并发调用复用同一次查询', async () => {
    const fetchImpl = vi.fn(async (input: string) =>
      input.includes('ipv4.icanhazip')
        ? new Response('203.0.113.9\n')
        : new Response('2001:db8::9\n')
    )
    const resolver = new PublicIpResolver({ fetchImpl: fetchImpl as unknown as FetchLike })

    const first = resolver.get()
    const second = resolver.get()
    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.objectContaining({ ipv4: expect.objectContaining({ address: '203.0.113.9' }) }),
      expect.objectContaining({ ipv6: expect.objectContaining({ address: '2001:db8::9' }) })
    ])
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })
})
