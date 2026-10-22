import { describe, expect, it, vi } from 'vitest'
import { listLocalAddresses, PromptPolisher } from './developer-tools'
import { validatePromptPolishInput } from '../ipc/validation'
import { AiGatewayError } from './ai-gateway/errors'

describe('我的 IP', () => {
  it('过滤回环、按网卡去重并保留 IPv6，不暴露 MAC 字段', () => {
    const row = {
      address: '192.168.1.2',
      family: 'IPv4' as const,
      netmask: '255.255.255.0',
      internal: false,
      mac: '00:00:00:00:00:00',
      cidr: '192.168.1.2/24'
    }
    const rows = listLocalAddresses({
      Loopback: [{ ...row, address: '127.0.0.1', internal: true }],
      WiFi: [
        row,
        row,
        { ...row, family: 'IPv6', address: 'fe80::1', netmask: 'ffff::', scopeid: 2 }
      ],
      Empty: undefined
    })
    expect(rows).toHaveLength(2)
    expect(rows[0]).toEqual({
      interfaceName: 'WiFi',
      family: 'IPv4',
      address: row.address,
      netmask: row.netmask
    })
    expect(rows[1].family).toBe('IPv6')
    expect(rows.every((item) => !Object.hasOwn(item, 'mac'))).toBe(true)
    expect(listLocalAddresses({})).toEqual([])
  })
})

describe('提示词 AI 美化', () => {
  it('拒绝空输入与过长原文，保留原文传给无工具的 AI 回调', async () => {
    expect(() => validatePromptPolishInput(' '.repeat(12001))).toThrow('12000')
    expect(() => validatePromptPolishInput(null)).toThrow()
    const call = vi.fn(async (_system: string, _user: string) => '请说明目标，并分析 {{context}}。')
    const polisher = new PromptPolisher(call)
    await expect(polisher.polish('')).rejects.toThrow('请填写')
    await expect(polisher.polish('分析 {{context}}')).resolves.toContain('{{context}}')
    expect(call.mock.calls[0][1]).toBe('分析 {{context}}')
  })

  it('拒绝删改、增加或改变重复占位符数量，失败后可重试', async () => {
    const call = vi.fn(async () => '请分析 {{context}} 和 {{context}}')
    const polisher = new PromptPolisher(call)
    call.mockResolvedValueOnce('请分析 {{context}}')
    await expect(polisher.polish('{{context}} {{context}}')).rejects.toThrow('变量')
    call.mockResolvedValueOnce('请分析 {{other}}')
    await expect(polisher.polish('{{context}}')).rejects.toThrow('变量')
    await expect(polisher.polish('{{context}} {{context}}')).resolves.toContain('{{context}}')
  })

  it('同时只运行一次润色，不回显未知异常或空白结果', async () => {
    let resolve!: (text: string) => void
    const call = vi.fn(
      () =>
        new Promise<string>((done) => {
          resolve = done
        })
    )
    const polisher = new PromptPolisher(call)
    const pending = polisher.polish('合成提示词')
    await expect(polisher.polish('另一条')).rejects.toThrow('正在润色')
    resolve('合成结果')
    await expect(pending).resolves.toBe('合成结果')
    call.mockRejectedValueOnce(new Error('synthetic-private-detail'))
    await expect(polisher.polish('合成提示词')).rejects.toThrow('请检查 AI 设置')
    call.mockRejectedValueOnce(new AiGatewayError('无法连接 AI 服务', new Error('合成请求诊断')))
    const safeError = await polisher.polish('合成提示词').catch((error: unknown) => error)
    expect(safeError).toMatchObject({ message: '无法连接 AI 服务' })
    expect(safeError).not.toHaveProperty('cause')
    call.mockResolvedValueOnce(' ')
    await expect(polisher.polish('合成提示词')).rejects.toThrow('为空')
  })
})
