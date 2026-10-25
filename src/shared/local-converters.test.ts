import { describe, expect, it } from 'vitest'
import { contrastRatio, convertRadix, convertUnit, parseColor } from './local-converters'

describe('离线颜色与换算', () => {
  it('HEX／RGB／HSL 相互转换', () => {
    expect(parseColor('#f00').rgb).toBe('rgb(255, 0, 0)')
    expect(parseColor('hsl(120, 100%, 50%)').hex).toBe('#00FF00')
    expect(parseColor('rgb(0, 0, 255)').hsl).toBe('hsl(240, 100%, 50%)')
    expect(parseColor('hsl(-120, 100%, 50%)').hex).toBe('#0000FF')
  })
  it('黑白对比 21:1，同色 1:1，拒绝透明或超限颜色', () => {
    expect(contrastRatio(parseColor('#000'), parseColor('#fff'))).toBe(21)
    expect(contrastRatio(parseColor('#abc'), parseColor('#abc'))).toBe(1)
    for (const input of ['rgba(0,0,0,0.5)', '#ffffffff', 'rgb(256,0,0)', 'hsl(0,101%,50%)'])
      expect(() => parseColor(input)).toThrow()
  })
  it('区分十进制与二进制字节，支持温度偏移与长度', () => {
    expect(convertUnit('1', 'data', 'KiB', 'B')).toBe('1024')
    expect(convertUnit('1', 'data', 'KB', 'B')).toBe('1000')
    expect(convertUnit('32', 'temperature', 'F', 'C')).toBe('0')
    expect(convertUnit('0', 'temperature', 'K', 'C')).toBe('-273.15')
    expect(convertUnit('1', 'length', 'in', 'cm')).toBe('2.54')
    expect(() => convertUnit('-274', 'temperature', 'C', 'K')).toThrow('绝对零度')
    expect(() => convertUnit('1e999', 'mass', 'kg', 'g')).toThrow('范围')
    expect(() => convertUnit('1', 'mass', 'm', 'g')).toThrow('类别')
  })
  it('大整数和负数进制不损失精度，拒绝无效数字', () => {
    expect(convertRadix('9007199254740993', 10, 16)).toBe('20000000000001')
    expect(convertRadix('-FF', 16, 2)).toBe('-11111111')
    expect(convertRadix('ZZ', 36, 10)).toBe('1295')
    expect(() => convertRadix('2', 2, 10)).toThrow('不属于')
    expect(() => convertRadix('1.1', 10, 16)).toThrow('整数')
    expect(() => convertRadix('1', 1, 10)).toThrow('2–36')
  })
})
