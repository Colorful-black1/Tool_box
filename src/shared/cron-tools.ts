/** Cron 预览只计算固定时区内的候选日，不逐秒遍历，也不实际调度任务。 */
export type CronDialect = 'spring' | 'quartz' | 'unix'

/** 解析后的字段说明与执行时间，时间统一为 epoch 毫秒。 */
export interface CronPreview {
  expression: string
  fields: { name: string; value: string; meaning: string }[]
  times: number[]
  limited: boolean
}

const MONTHS = 'JAN FEB MAR APR MAY JUN JUL AUG SEP OCT NOV DEC'.split(' ')
const WEEKDAYS = 'SUN MON TUE WED THU FRI SAT'.split(' ')
const MACROS: Record<string, string> = {
  '@yearly': '0 0 0 1 1 *',
  '@annually': '0 0 0 1 1 *',
  '@monthly': '0 0 0 1 * *',
  '@weekly': '0 0 0 * * 0',
  '@daily': '0 0 0 * * *',
  '@midnight': '0 0 0 * * *',
  '@hourly': '0 0 * * * *'
}

function values(raw: string, min: number, max: number, label: string): number[] {
  const result = new Set<number>()
  for (const item of raw.split(',')) {
    const match = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/.exec(item)
    if (!match) throw new Error(`${label}的写法无效`)
    const step = match[2] ? Number(match[2]) : 1
    const range = match[1].split('-').map(Number)
    const start = match[1] === '*' ? min : range[0]
    const end = match[1] === '*' || (match[2] && range.length === 1) ? max : (range[1] ?? start)
    if (start < min || end > max || start > end || step < 1 || step > max - min + 1)
      throw new Error(`${label}应在 ${min}–${max} 范围内，步长必须大于零且不超过字段跨度`)
    for (let n = start; n <= end; n += step) result.add(n)
  }
  return [...result].sort((a, b) => a - b)
}

function names(raw: string, list: string[], start: number): string {
  return raw.replace(/[A-Z]{3}/g, (word) => {
    const index = list.indexOf(word)
    if (index < 0) throw new Error('月份或星期名称无效')
    return String(index + start)
  })
}

function dayMatcher(raw: string, week: boolean, dialect: CronDialect): (date: Date) => boolean {
  if (raw === '*' || (raw === '?' && dialect !== 'unix')) return () => true
  if (dialect === 'quartz' && /[LW#]/.test(raw) && raw.includes(','))
    throw new Error('Quartz 的 L / W / # 条件暂不支持与列表混用')
  const min = week ? (dialect === 'quartz' ? 1 : 0) : 1
  const max = week ? 7 : 31
  const weekday = (n: number): number => (dialect === 'quartz' ? n - 1 : n % 7)
  const rules = raw.split(',').map((item) => {
    if (dialect !== 'unix') {
      if (!week && /^(L(?:-\d+)?|LW|\d+W)$/.test(item)) {
        const offset = item.startsWith('L-') ? Number(item.slice(2)) : 0
        const nearest = /^\d+W$/.test(item) ? Number(item.slice(0, -1)) : null
        if (
          (item.startsWith('L-') && offset < 1) ||
          offset > 30 ||
          (nearest !== null && (nearest < 1 || nearest > 31))
        )
          throw new Error('日期偏移或工作日范围无效')
        return (date: Date): boolean => {
          const year = date.getUTCFullYear(),
            month = date.getUTCMonth()
          const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
          let target = nearest ?? last - offset
          if (target < 1 || target > last) return false
          if (item.endsWith('W')) {
            const dow = new Date(Date.UTC(year, month, target)).getUTCDay()
            if (dow === 6) target += target === 1 ? 2 : -1
            // Spring 的 nW 向后找周一；Quartz 在月底保持在当月，LW 始终为当月最后工作日。
            if (dow === 0)
              target += target === last && (nearest === null || dialect === 'quartz') ? -2 : 1
          }
          return date.getUTCDate() === target
        }
      }
      const special = week ? /^(\d+)(L|#[1-5])$/.exec(item) : null
      if (special) {
        const n = Number(special[1])
        if (n < min || n > max) throw new Error('星期范围无效')
        return (date: Date): boolean =>
          date.getUTCDay() === weekday(n) &&
          (special[2] === 'L'
            ? new Date(date.getTime() + 7 * 86400000).getUTCMonth() !== date.getUTCMonth()
            : Math.ceil(date.getUTCDate() / 7) === Number(special[2].slice(1)))
      }
      if (week && item === 'L' && dialect === 'quartz')
        return (date: Date) => date.getUTCDay() === 6
    }
    const allowed = values(item, min, max, week ? '星期' : '日期')
    return (date: Date): boolean =>
      week
        ? allowed.some((n) => weekday(n) === date.getUTCDay())
        : allowed.includes(date.getUTCDate())
  })
  return (date) => rules.some((rule) => rule(date))
}

/** Spring 的两个日期条件同时满足；Unix 两个受限日期条件满足其一；Quartz 必须有一个 ?。 */
export function previewCron(
  source: string,
  dialect: CronDialect,
  after: number,
  offsetMinutes = 480
): CronPreview {
  if (!['spring', 'quartz', 'unix'].includes(dialect)) throw new Error('Cron 格式无效')
  if (!Number.isFinite(after) || ![0, 480].includes(offsetMinutes))
    throw new Error('起点或时区无效')
  if (source.length > 256 || !source.trim()) throw new Error('请输入 1 至 256 字符的 Cron 表达式')
  let expression = source.trim()
  if (dialect === 'spring') expression = MACROS[expression.toLowerCase()] ?? expression
  const original = expression.toUpperCase().split(/\s+/)
  if (
    (dialect === 'unix' && original.length !== 5) ||
    (dialect === 'spring' && original.length !== 6) ||
    (dialect === 'quartz' && ![6, 7].includes(original.length))
  )
    throw new Error(
      dialect === 'unix'
        ? 'Unix 需要五段：分 时 日 月 周'
        : dialect === 'spring'
          ? 'Spring 需要六段：秒 分 时 日 月 周'
          : 'Quartz 需要六或七段，最后可带年份'
    )
  const parts = dialect === 'unix' ? ['0', ...original] : [...original]
  parts[4] = names(parts[4], MONTHS, 1)
  parts[5] = names(parts[5], WEEKDAYS, dialect === 'quartz' ? 1 : 0)
  if (dialect === 'quartz' && (parts[3] === '?') === (parts[5] === '?'))
    throw new Error('Quartz 的日期与星期字段必须且只能有一个为 ?')
  const seconds = values(parts[0], 0, 59, '秒')
  const minutes = values(parts[1], 0, 59, '分钟')
  const hours = values(parts[2], 0, 23, '小时')
  const months = values(parts[4], 1, 12, '月份')
  const years = parts[6] ? values(parts[6], 1970, 2099, '年份') : null
  const dom = dayMatcher(parts[3], false, dialect)
  const dow = dayMatcher(parts[5], true, dialect)
  const shifted = after + offsetMinutes * 60000
  const first = new Date(shifted)
  const start = Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), first.getUTCDate())
  if (!Number.isFinite(start) || first.getUTCFullYear() < 1970 || first.getUTCFullYear() > 2099)
    throw new Error('起点年份应在 1970–2099 之间')
  const end = Date.UTC(first.getUTCFullYear() + 8, first.getUTCMonth(), first.getUTCDate())
  const times: number[] = []
  for (let day = start; day <= end && times.length < 10; day += 86400000) {
    const date = new Date(day)
    if (
      !months.includes(date.getUTCMonth() + 1) ||
      (years && !years.includes(date.getUTCFullYear()))
    )
      continue
    const match =
      dialect === 'unix' && !parts[3].includes('*') && !parts[5].includes('*')
        ? dom(date) || dow(date)
        : dom(date) && dow(date)
    if (!match) continue
    for (const hour of hours) {
      if (day + (hour + 1) * 3600000 <= shifted) continue
      for (const minute of minutes) {
        if (day + hour * 3600000 + (minute + 1) * 60000 <= shifted) continue
        for (const second of seconds) {
          const candidate = day + hour * 3600000 + minute * 60000 + second * 1000
          if (candidate > shifted) times.push(candidate - offsetMinutes * 60000)
          if (times.length === 10) break
        }
        if (times.length === 10) break
      }
      if (times.length === 10) break
    }
  }
  const labels = ['秒', '分钟', '小时', '日期', '月份', '星期', '年份']
  return {
    expression,
    fields: original.map((value, index) => {
      const i = dialect === 'unix' ? index + 1 : index
      const meaning =
        value === '?'
          ? '不指定'
          : value === '*'
            ? '所有取值'
            : i === 5
              ? `星期条件（${dialect === 'quartz' ? '1=周日，7=周六' : '0/7=周日，1=周一'}）`
              : i === 3 && /L|W|#/.test(value)
                ? '月底 / 工作日 / 第几周条件'
                : value.includes('/')
                  ? '按步长匹配'
                  : value.includes('-')
                    ? '区间内匹配'
                    : '指定值匹配'
      return { name: labels[i], value, meaning }
    }),
    times,
    limited: times.length < 10
  }
}

export function formatCronTime(time: number, offsetMinutes: number): string {
  return new Date(time + offsetMinutes * 60000).toISOString().slice(0, 19).replace('T', ' ')
}

/** 日期输入按所选固定时区解析，拒绝 Date 自动修正的无效日期。 */
export function parseCronStart(text: string, offsetMinutes: number): number {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(text))
    throw new Error('请选择有效的计算起点')
  const normalized = text.length === 16 ? `${text}:00` : text
  const ms = Date.parse(`${normalized}Z`)
  if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 19) !== normalized)
    throw new Error('计算起点的日期无效')
  return ms - offsetMinutes * 60000
}
