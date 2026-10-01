import { describe, expect, it } from 'vitest'

import desktopEnvelope from './desktop-envelope.fixture.json'
import {
  ENVELOPE_VERSION,
  IV_BYTE_LENGTH,
  TAG_BYTE_LENGTH,
  base64ToBytes,
  bytesToBase64,
  bytesToPayload,
  envelopeVersion,
  packEnvelope,
  payloadToBytes,
  unpackEnvelope
} from './secret-envelope'

describe('base64 与字节互转', () => {
  it('往返一致（含高位字节）', () => {
    const bytes = new Uint8Array([0, 1, 127, 128, 255, 42])
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes)
  })

  it('空数组往返为空', () => {
    expect(bytesToBase64(new Uint8Array([]))).toBe('')
    expect(base64ToBytes('')).toEqual(new Uint8Array([]))
  })
})

describe('信封打包与解包', () => {
  const iv = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
  const tag = new Uint8Array(16).fill(7)
  const data = new Uint8Array([200, 100, 0, 255])

  it('打包后字段齐全且为 base64', () => {
    const envelope = JSON.parse(packEnvelope({ iv, tag, data })) as Record<string, unknown>
    expect(envelope.v).toBe(ENVELOPE_VERSION)
    expect(typeof envelope.iv).toBe('string')
    expect(typeof envelope.tag).toBe('string')
    expect(typeof envelope.data).toBe('string')
  })

  it('解包还原出原始字节', () => {
    const parsed = unpackEnvelope(packEnvelope({ iv, tag, data }))
    expect(parsed.iv).toEqual(iv)
    expect(parsed.tag).toEqual(tag)
    expect(parsed.data).toEqual(data)
  })

  it('明文负载（含中文）往返一致', () => {
    const payload = { account: 'me@example.com', password: 'p@ss 中文', remark: '备注' }
    expect(bytesToPayload(payloadToBytes(payload))).toEqual(payload)
  })

  it('拒绝残缺或版本不符的信封', () => {
    expect(() => unpackEnvelope('{}')).toThrow('密文格式无效')
    expect(() => unpackEnvelope('{"v":2,"iv":"a","tag":"b","data":"c"}')).toThrow('密文格式无效')
    expect(() => unpackEnvelope('{"v":1,"iv":"","tag":"b","data":"c"}')).toThrow('密文格式无效')
    expect(() => unpackEnvelope('not-json')).toThrow()
  })

  it('envelopeVersion 不抛错，只回报版本', () => {
    expect(envelopeVersion(packEnvelope({ iv, tag, data }))).toBe(ENVELOPE_VERSION)
    expect(envelopeVersion('not-json')).toBeNull()
    expect(envelopeVersion('{"v":9}')).toBe(9)
  })
})

describe('与桌面端密文格式兼容', () => {
  /**
   * 样本由桌面端 SafeStorageSecretBox 真实实现产出（node:crypto aes-256-gcm）。
   * 手机端必须能解析同一信封，否则「两端密文结构一致」只是口头承诺。
   */
  it('能解析桌面端产出的信封，且 iv/tag 长度符合 AES-GCM 规范', () => {
    const parsed = unpackEnvelope(desktopEnvelope.cipherText)

    expect(parsed.iv.length).toBe(IV_BYTE_LENGTH)
    expect(parsed.tag.length).toBe(TAG_BYTE_LENGTH)
    expect(parsed.data.length).toBeGreaterThan(0)
  })

  it('样本自洽：桌面端给的明文负载字段与手机端一致', () => {
    expect(Object.keys(desktopEnvelope.payload).sort()).toEqual(['account', 'password', 'remark'])
  })

  it('桌面端信封的字段集合与手机端产出的完全相同', () => {
    const desktopKeys = Object.keys(
      JSON.parse(desktopEnvelope.cipherText) as Record<string, unknown>
    ).sort()
    const mobileKeys = Object.keys(
      JSON.parse(
        packEnvelope({ iv: new Uint8Array(12), tag: new Uint8Array(16), data: new Uint8Array(1) })
      ) as Record<string, unknown>
    ).sort()

    expect(mobileKeys).toEqual(desktopKeys)
  })
})