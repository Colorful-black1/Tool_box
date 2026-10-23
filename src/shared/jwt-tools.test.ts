import { describe, expect, it } from 'vitest'
import { inspectJwt } from './jwt-tools'

const encode = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString('base64url')
const token = (payload: unknown, alg = 'HS256'): string =>
  `${encode({ alg })}.${encode(payload)}.YWJj`

describe('JWT 本地查看', () => {
  it('深层载荷在格式化前拒绝，防止渲染栈溢出', () => {
    const json = '{"a":'.repeat(40) + '0' + '}'.repeat(40)
    expect(() =>
      inspectJwt(`${encode({ alg: 'HS256' })}.${Buffer.from(json).toString('base64url')}.YWJj`)
    ).toThrow('32 层')
  })
  it('支持 Bearer 与 Unicode，始终提示未验签，检查 UTC 时间声明', () => {
    const result = inspectJwt(`Bearer ${token({ sub: '用户', exp: 10, nbf: 20, iat: 30 })}`, 15000)
    expect(result.payload.sub).toBe('用户')
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        '签名未验证，不能据此判断令牌真实有效',
        '令牌已过期（exp）',
        '令牌尚未生效（nbf）',
        '签发时间晚于当前时间（iat）'
      ])
    )
    expect(result.claims[0].value).toBe('1970-01-01T00:00:30.000Z')
  })
  it('不将非法时间或无签名令牌当成有效凭据', () => {
    expect(inspectJwt(token({ exp: '100' }, 'none')).warnings).toContain(
      'exp 不是有效的 NumericDate 秒数'
    )
    expect(inspectJwt(`${encode({ alg: 'none' })}.${encode({})}.`).warnings).toContain(
      '令牌未签名或签名为空'
    )
  })
  it.each([
    'a.b.c.d.e',
    'a.b',
    '!.e30.YWJj',
    `${encode({})}.${encode([])}.YWJj`,
    `e30._w.YWJj`,
    ' '.repeat(32769)
  ])('拒绝非法令牌且不回显输入', (source) => {
    expect(() => inspectJwt(source)).toThrow()
    try {
      inspectJwt(source)
    } catch (error) {
      expect(String(error)).not.toContain(source.slice(0, 100))
    }
  })
})
