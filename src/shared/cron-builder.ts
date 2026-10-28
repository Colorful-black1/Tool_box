import type { CronDialect } from './cron-tools'

/** Cron 字段名；顺序与表达式一致，周和年按方言可选。 */
export type CronFieldKey = 'second' | 'minute' | 'hour' | 'day' | 'month' | 'week' | 'year'

/** 每个字段的输入方式：全部、范围、间隔、指定、不指定。 */
export type CronFieldMode = 'every' | 'range' | 'step' | 'list' | 'unspecified'

export interface CronFieldState {
  mode: CronFieldMode
  /** 范围起点；周字段存 SUN…SAT，其余存数字字符串。 */
  from: string
  /** 范围终点；周字段存 SUN…SAT，其余存数字字符串。 */
  to: string
  /** 间隔起点；周字段存 SUN…SAT，其余存数字字符串。 */
  start: string
  step: string
  /** 指定值；周字段存逗号分隔的英文缩写。 */
  list: string
}

export type CronFieldStates = Record<CronFieldKey, CronFieldState>

export interface CronFieldMeta {
  label: string
  min: number
  max: number
  unit: string
  placeholder: string
}

export const CRON_BUILDER_FIELDS: Record<CronFieldKey, CronFieldMeta> = {
  second: { label: '秒', min: 0, max: 59, unit: '秒', placeholder: '0,15,30,45' },
  minute: { label: '分钟', min: 0, max: 59, unit: '分钟', placeholder: '0,15,30,45' },
  hour: { label: '小时', min: 0, max: 23, unit: '小时', placeholder: '9,12,18' },
  day: { label: '日', min: 1, max: 31, unit: '天', placeholder: '1,15,28' },
  month: { label: '月', min: 1, max: 12, unit: '个月', placeholder: '1,4,7,10' },
  week: { label: '周', min: 0, max: 7, unit: '个取值', placeholder: 'MON,WED,FRI' },
  year: { label: '年', min: 1970, max: 2099, unit: '年', placeholder: '2026,2028' }
}

/** 周字段统一用英文缩写，生成器按方言换算编号，避免 0/1 起点混淆。 */
export const CRON_WEEKDAYS = [
  { value: 'SUN', label: '周日' },
  { value: 'MON', label: '周一' },
  { value: 'TUE', label: '周二' },
  { value: 'WED', label: '周三' },
  { value: 'THU', label: '周四' },
  { value: 'FRI', label: '周五' },
  { value: 'SAT', label: '周六' }
] as const

const WEEKDAY_ORDER: string[] = CRON_WEEKDAYS.map((day) => day.value)

/** Unix 无秒和年，Spring 无年；顺序同时用于界面行和表达式拼接。 */
export function visibleCronFields(dialect: CronDialect): CronFieldKey[] {
  if (dialect === 'unix') return ['minute', 'hour', 'day', 'month', 'week']
  if (dialect === 'spring') return ['second', 'minute', 'hour', 'day', 'month', 'week']
  return ['second', 'minute', 'hour', 'day', 'month', 'week', 'year']
}

function fieldDefaults(key: CronFieldKey): CronFieldState {
  const meta = CRON_BUILDER_FIELDS[key]
  const currentYear = String(new Date().getFullYear())
  const numeric = key === 'year' ? currentYear : String(meta.min)
  const week = key === 'week'
  return {
    mode: 'every',
    from: week ? 'MON' : numeric,
    to: week ? 'FRI' : key === 'year' ? currentYear : String(meta.max),
    start: week ? 'MON' : numeric,
    step: '1',
    list: week ? 'MON,TUE,WED,THU,FRI' : numeric
  }
}

/** 默认工作日九点：Quartz 的日必须为 ?，其余方言用日 * 与周 MON-FRI。 */
export function defaultCronFields(dialect: CronDialect): CronFieldStates {
  const fields: CronFieldStates = {
    second: { ...fieldDefaults('second'), mode: 'list', list: '0' },
    minute: { ...fieldDefaults('minute'), mode: 'list', list: '0' },
    hour: { ...fieldDefaults('hour'), mode: 'list', list: '9' },
    day: fieldDefaults('day'),
    month: fieldDefaults('month'),
    week: { ...fieldDefaults('week'), mode: 'range', from: 'MON', to: 'FRI' },
    year: fieldDefaults('year')
  }
  if (dialect === 'quartz') fields.day = { ...fields.day, mode: 'unspecified' }
  return fields
}

function cloneFields(fields: CronFieldStates): CronFieldStates {
  return Object.fromEntries(
    (Object.keys(fields) as CronFieldKey[]).map((key) => [key, { ...fields[key] }])
  ) as CronFieldStates
}

/**
 * 切换方言时修正日/周：Quartz 必须且只能有一个 ?，其他方言不支持 ?。
 * 尽量保留更具体的那个字段：日/周都为 * 时优先保留周，日/周都具体时也优先保留周。
 */
export function normalizeCronFields(
  fields: CronFieldStates,
  dialect: CronDialect
): CronFieldStates {
  const next = cloneFields(fields)
  if (dialect === 'quartz') {
    const dayUnset = next.day.mode === 'unspecified'
    const weekUnset = next.week.mode === 'unspecified'
    if (dayUnset && weekUnset) {
      next.week = { ...next.week, mode: 'every' }
    } else if (!dayUnset && !weekUnset) {
      if (next.day.mode === 'every' && next.week.mode !== 'every')
        next.day = { ...next.day, mode: 'unspecified' }
      else if (next.week.mode === 'every' && next.day.mode !== 'every')
        next.week = { ...next.week, mode: 'unspecified' }
      else next.day = { ...next.day, mode: 'unspecified' }
    }
  } else {
    if (next.day.mode === 'unspecified') next.day = { ...next.day, mode: 'every' }
    if (next.week.mode === 'unspecified') next.week = { ...next.week, mode: 'every' }
  }
  return next
}

function numericValue(key: CronFieldKey, raw: string): number {
  const meta = CRON_BUILDER_FIELDS[key]
  const text = raw.trim()
  if (!text) throw new Error(`请填写${meta.label}`)
  const value = Number(text)
  if (!Number.isInteger(value) || value < meta.min || value > meta.max)
    throw new Error(`${meta.label}应为 ${meta.min}–${meta.max} 的整数`)
  return value
}

function weekdayIndex(raw: string): number {
  const index = WEEKDAY_ORDER.indexOf(raw)
  if (index < 0) throw new Error('请选择有效的星期')
  return index
}

function buildField(key: CronFieldKey, field: CronFieldState): string {
  const meta = CRON_BUILDER_FIELDS[key]
  switch (field.mode) {
    case 'every':
      return '*'
    case 'unspecified':
      return '?'
    case 'range': {
      if (key === 'week') {
        if (weekdayIndex(field.from) > weekdayIndex(field.to))
          throw new Error('周的范围结束值不能早于开始值')
        return `${field.from}-${field.to}`
      }
      const from = numericValue(key, field.from)
      const to = numericValue(key, field.to)
      if (from > to) throw new Error(`${meta.label}的范围结束值不能早于开始值`)
      return `${from}-${to}`
    }
    case 'step': {
      const step = Number(field.step)
      const maxStep = key === 'week' ? 7 : meta.max - meta.min + 1
      if (!Number.isInteger(step) || step < 1 || step > maxStep)
        throw new Error(`${meta.label}的间隔应为 1–${maxStep}`)
      if (key === 'week') {
        weekdayIndex(field.start)
        return `${field.start}/${step}`
      }
      return `${numericValue(key, field.start)}/${step}`
    }
    case 'list': {
      if (key === 'week') {
        const values = field.list
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean)
        if (!values.length) throw new Error('请至少选择一个星期')
        const unique = [...new Set(values)]
        for (const value of unique) weekdayIndex(value)
        unique.sort((a, b) => weekdayIndex(a) - weekdayIndex(b))
        return unique.join(',')
      }
      const values = field.list
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean)
      if (!values.length) throw new Error(`请填写${meta.label}的指定值`)
      const unique = [...new Set(values.map((value) => numericValue(key, value)))]
      unique.sort((a, b) => a - b)
      return unique.join(',')
    }
  }
  throw new Error('字段模式无效')
}

export function buildCronExpression(dialect: CronDialect, fields: CronFieldStates): string {
  if (!['spring', 'quartz', 'unix'].includes(dialect)) throw new Error('Cron 格式无效')
  if (dialect === 'quartz') {
    const dayUnset = fields.day.mode === 'unspecified'
    const weekUnset = fields.week.mode === 'unspecified'
    if (dayUnset === weekUnset) throw new Error('Quartz 的日与周必须且只能有一个为不指定')
  } else if (fields.day.mode === 'unspecified' || fields.week.mode === 'unspecified') {
    throw new Error('仅 Quartz 支持不指定')
  }
  return visibleCronFields(dialect)
    .map((key) => buildField(key, fields[key]))
    .join(' ')
}

/** 由具体时刻生成逐字段配置：固定字段用“指定”，周字段按方言置为 * 或 ?。 */
export function cronFieldsFromTime(
  time: number,
  dialect: CronDialect,
  offsetMinutes = 480
): CronFieldStates {
  if (!Number.isFinite(time) || ![0, 480].includes(offsetMinutes))
    throw new Error('时间或时区无效')
  const date = new Date(time + offsetMinutes * 60000)
  const year = date.getUTCFullYear()
  if (year < 1970 || year > 2099) throw new Error('目标年份应在 1970–2099 之间')
  const fields = defaultCronFields(dialect)
  const setList = (key: CronFieldKey, value: number): void => {
    fields[key] = { ...fields[key], mode: 'list', list: String(value) }
  }
  if (dialect !== 'unix') setList('second', date.getUTCSeconds())
  setList('minute', date.getUTCMinutes())
  setList('hour', date.getUTCHours())
  setList('day', date.getUTCDate())
  setList('month', date.getUTCMonth() + 1)
  if (dialect === 'quartz') {
    fields.week = { ...fields.week, mode: 'unspecified' }
    fields.year = { ...fields.year, mode: 'list', list: String(year) }
  } else {
    fields.week = { ...fields.week, mode: 'every' }
    fields.year = { ...fields.year, mode: 'every' }
  }
  return fields
}
