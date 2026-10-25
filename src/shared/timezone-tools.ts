export const COMMON_TIMEZONES = [
  'Asia/Shanghai',
  'Asia/Tokyo',
  'Asia/Kolkata',
  'Asia/Singapore',
  'Asia/Dubai',
  'Europe/London',
  'Europe/Paris',
  'America/New_York',
  'America/Los_Angeles',
  'Australia/Sydney',
  'Pacific/Auckland',
  'UTC'
]
export type TimeDisambiguation = 'reject' | 'earlier' | 'later'

function formatter(zone: string): Intl.DateTimeFormat {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: zone,
      calendar: 'iso8601',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23'
    })
  } catch {
    throw new Error('时区无效，请输入 IANA 名称，例如 Asia/Shanghai')
  }
}

function partsMs(ms: number, format: Intl.DateTimeFormat): number {
  const parts = format.formatToParts(new Date(ms))
  const number = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value)
  return Date.UTC(
    number('year'),
    number('month') - 1,
    number('day'),
    number('hour'),
    number('minute'),
    number('second')
  )
}

/** 把墙上时间映射为瞬时值；DST 重叠需要显式选择，缺口不自动平移。 */
export function zonedDateTimeToMs(
  text: string,
  zone: string,
  choice: TimeDisambiguation = 'reject'
): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(text.trim())
  if (!match) throw new Error('日期时间格式应为 YYYY-MM-DD HH:mm:ss')
  const [, year, month, day, hour, minute, second = '0'] = match
  const wall = Date.UTC(+year, +month - 1, +day, +hour, +minute, +second)
  if (
    +year < 100 ||
    new Date(wall).toISOString().slice(0, 19) !==
      `${year}-${month}-${day}T${hour}:${minute}:${second.padStart(2, '0')}`
  )
    throw new Error('日期或时间无效')
  const format = formatter(zone)
  const offsets = new Set<number>()
  for (let delta = -36; delta <= 36; delta += 6) {
    const sample = wall + delta * 3600000
    offsets.add(partsMs(sample, format) - sample)
  }
  const candidates = [...offsets]
    .map((offset) => wall - offset)
    .filter((ms) => partsMs(ms, format) === wall)
    .sort((a, b) => a - b)
  if (!candidates.length) throw new Error('该时区不存在此时间（夏令时跳跃），请调整时间')
  if (candidates.length > 1 && choice === 'reject')
    throw new Error('此时间因夏令时重复，请选择较早或较晚时刻')
  return choice === 'later' ? candidates[candidates.length - 1] : candidates[0]
}

export function formatInTimezone(ms: number, zone: string): string {
  const format = formatter(zone)
  if (!Number.isFinite(ms) || !Number.isFinite(new Date(ms).getTime()))
    throw new Error('时间戳超出范围')
  return format.format(new Date(ms)) + ` · ${zone}`
}
