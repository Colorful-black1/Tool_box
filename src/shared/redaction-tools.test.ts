import { describe, expect, it } from 'vitest'
import { DEFAULT_REDACTION_RULES, redactData } from './redaction-tools'

describe('本机脱敏', () => {
  it('敏感字段与重复引用使用一致替身，长整数保持不变', () => {
    const input =
      '{"password":"synthetic-value","again":"synthetic-value","id":9223372036854775807}'
    const result = redactData(input, { ...DEFAULT_REDACTION_RULES, identity: false, bank: false })
    expect(result.output).not.toContain('synthetic-value')
    expect(result.output).toContain('9223372036854775807')
    const parsed = JSON.parse(result.output)
    expect(parsed.password).toBe(parsed.again)
    expect(result.counts.credential).toBeGreaterThan(0)
  })
  it('清理请求头、键值凭据和邮箱，不暴露映射表', () => {
    const result = redactData(
      'Authorization: Bearer fixture-secret\napi_key="fixture-secret"\nuser@example.invalid'
    )
    expect(result.output).not.toContain('fixture-secret')
    expect(result.output).not.toContain('user@example.invalid')
    expect(Object.keys(result)).toEqual(['output', 'counts', 'structured'])
  })
  it('先出现的普通字段引用也与后面的凭据字段一致', () => {
    const result = redactData(
      '{"note":"fixture-first","token":"fixture-second","password":"fixture-first"}'
    )
    const value = JSON.parse(result.output)
    expect(value.note).toBe(value.password)
    expect(value.token).not.toBe(value.password)
    expect(result.counts.credential).toBe(3)
  })
  it('不同引号与转义表示同一值时使用相同替身', () => {
    const output = redactData(
      'password=fixture-value pwd="fixture-value" token=\'fixture-value\''
    ).output
    expect(output).toBe('password=[凭据_1] pwd="[凭据_1]" token=\'[凭据_1]\'')
    expect(redactData("password='fixture\\'value'").output).not.toContain('value')
  })
  it('生成的替身不会与原文已有标记混淆', () => {
    const result = redactData('{"literal":"[凭据_1]","token":"fixture-value"}')
    expect(JSON.parse(result.output).token).toBe('[凭据_2]')
  })
  it('规则可以关闭；损坏 JSON 不静默按普通文本处理', () => {
    expect(
      redactData('user@example.invalid', { ...DEFAULT_REDACTION_RULES, email: false }).output
    ).toBe('user@example.invalid')
    expect(() => redactData('{"password":"x"')).toThrow()
    expect(redactData('{unfinished', DEFAULT_REDACTION_RULES, 'text').output).toBe('{unfinished')
  })
  it('识别合成号码与银行卡候选，同一邮箱重复使用替身', () => {
    const phone = '138' + '0'.repeat(8)
    const identity = '110101' + '19900101' + '123X'
    const bank = '4' + '1'.repeat(15)
    const result = redactData(
      [phone, identity, bank, 'a@example.invalid', 'a@example.invalid'].join('\n')
    )
    for (const value of [phone, identity, bank]) expect(result.output).not.toContain(value)
    expect(result.counts.email).toBe(2)
    expect(result.output.split('\n').at(-1)).toBe(result.output.split('\n').at(-2))
  })
})
