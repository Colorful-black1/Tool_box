/** 离线换算；单位选项由同一份表驱动 UI 与计算。 */
export const UNIT_GROUPS = {
  length: {
    label: '长度',
    units: [
      ['m', '米', 1],
      ['km', '千米', 1000],
      ['cm', '厘米', 0.01],
      ['mm', '毫米', 0.001],
      ['in', '英寸', 0.0254],
      ['ft', '英尺', 0.3048]
    ]
  },
  mass: {
    label: '质量',
    units: [
      ['kg', '千克', 1],
      ['g', '克', 0.001],
      ['mg', '毫克', 0.000001],
      ['lb', '磅', 0.45359237]
    ]
  },
  time: {
    label: '时间',
    units: [
      ['s', '秒', 1],
      ['ms', '毫秒', 0.001],
      ['min', '分钟', 60],
      ['h', '小时', 3600],
      ['d', '天（24 小时）', 86400]
    ]
  },
  data: {
    label: '数据大小',
    units: [
      ['B', 'B', 1],
      ['KB', 'KB（1000 B）', 1000],
      ['MB', 'MB', 1e6],
      ['GB', 'GB', 1e9],
      ['KiB', 'KiB（1024 B）', 1024],
      ['MiB', 'MiB', 1048576],
      ['GiB', 'GiB', 1073741824]
    ]
  },
  temperature: {
    label: '温度',
    units: [
      ['C', '摄氏度 °C', 1],
      ['F', '华氏度 °F', 1],
      ['K', '开尔文 K', 1]
    ]
  }
} as const
export type UnitGroup = keyof typeof UNIT_GROUPS

export function convertUnit(text: string, group: UnitGroup, from: string, to: string): string {
  if (!text.trim()) return ''
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text.trim()))
    throw new Error('请输入有效数字')
  const value = Number(text)
  const source = UNIT_GROUPS[group].units.find((unit) => unit[0] === from)
  const target = UNIT_GROUPS[group].units.find((unit) => unit[0] === to)
  if (!source || !target) throw new Error('单位不属于当前类别')
  let result = (value * source[2]) / target[2]
  if (group === 'temperature') {
    const celsius = from === 'F' ? ((value - 32) * 5) / 9 : from === 'K' ? value - 273.15 : value
    if (celsius < -273.15 - 1e-10) throw new Error('温度不能低于绝对零度')
    result = to === 'F' ? (celsius * 9) / 5 + 32 : to === 'K' ? celsius + 273.15 : celsius
  } else if (group === 'data' && value < 0) throw new Error('数据大小不能为负数')
  if (!Number.isFinite(result)) throw new Error('数值超出可换算范围')
  return String(Number(result.toPrecision(12)))
}

/** 显式逐位积累 BigInt，禁止先经 Number 解析而损失大整数。 */
export function convertRadix(text: string, from: number, to: number): string {
  if (![from, to].every((base) => Number.isInteger(base) && base >= 2 && base <= 36))
    throw new Error('进制必须为 2–36')
  const input = text.trim().toLowerCase()
  if (!input) return ''
  if (input.length > 4096) throw new Error('整数最多 4096 个字符')
  if (!/^[+-]?[0-9a-z]+$/.test(input)) throw new Error('请输入整数，不包含小数点或 0x 等前缀')
  const digits = input.replace(/^[+-]/, '')
  let value = 0n
  for (const char of digits) {
    const digit = parseInt(char, 36)
    if (digit >= from) throw new Error(`数字 ${char} 不属于 ${from} 进制`)
    value = value * BigInt(from) + BigInt(digit)
  }
  return (input[0] === '-' ? -value : value).toString(to).toUpperCase()
}

/** 只支持不透明 sRGB，防止误把透明色直接用于对比度计算。 */
export interface ColorValue {
  hex: string
  rgb: string
  hsl: string
  channels: [number, number, number]
}

export function parseColor(text: string): ColorValue {
  const input = text.trim().toLowerCase()
  let rgb: number[]
  const hex = /^#?([\da-f]{3}|[\da-f]{6})$/.exec(input)
  const rgbMatch =
    /^rgb\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*\)$/.exec(input)
  const hslMatch =
    /^hsl\(\s*([+-]?\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)%\s*,\s*(\d+(?:\.\d+)?)%\s*\)$/.exec(input)
  if (hex) {
    const full = hex[1].length === 3 ? [...hex[1]].map((char) => char + char).join('') : hex[1]
    rgb = [0, 2, 4].map((offset) => parseInt(full.slice(offset, offset + 2), 16))
  } else if (rgbMatch) {
    rgb = rgbMatch.slice(1).map(Number)
    if (rgb.some((value) => value > 255)) throw new Error('RGB 通道应为 0–255')
  } else if (hslMatch) {
    const [, hue, saturation, lightness] = hslMatch.map(Number)
    if (saturation > 100 || lightness > 100 || !Number.isFinite(hue))
      throw new Error('HSL 色相无效或百分比超出 0–100')
    const h = (((hue % 360) + 360) % 360) / 60
    const s = saturation / 100
    const l = lightness / 100
    const c = (1 - Math.abs(2 * l - 1)) * s
    const x = c * (1 - Math.abs((h % 2) - 1))
    const pairs = [
      [c, x, 0],
      [x, c, 0],
      [0, c, x],
      [0, x, c],
      [x, 0, c],
      [c, 0, x]
    ]
    rgb = pairs[Math.floor(h)].map((value) => (value + l - c / 2) * 255)
  } else throw new Error('支持 #RGB、#RRGGBB、rgb(255, 0, 0)、hsl(0, 100%, 50%)')
  const channels = rgb.map(Math.round) as [number, number, number]
  const scaled = channels.map((value) => value / 255)
  const max = Math.max(...scaled)
  const min = Math.min(...scaled)
  const delta = max - min
  const l = (max + min) / 2
  const s = delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1))
  const h =
    delta === 0
      ? 0
      : max === scaled[0]
        ? ((scaled[1] - scaled[2]) / delta) % 6
        : max === scaled[1]
          ? (scaled[2] - scaled[0]) / delta + 2
          : (scaled[0] - scaled[1]) / delta + 4
  return {
    channels,
    hex:
      '#' +
      channels
        .map((value) => value.toString(16).padStart(2, '0'))
        .join('')
        .toUpperCase(),
    rgb: `rgb(${channels.join(', ')})`,
    hsl: `hsl(${Math.round((h * 60 + 360) % 360)}, ${+(s * 100).toFixed(1)}%, ${+(l * 100).toFixed(1)}%)`
  }
}

export function contrastRatio(a: ColorValue, b: ColorValue): number {
  const luminance = (color: ColorValue): number => {
    const values = color.channels.map((value) => {
      const channel = value / 255
      return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
    })
    return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722
  }
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (values[0] + 0.05) / (values[1] + 0.05)
}
