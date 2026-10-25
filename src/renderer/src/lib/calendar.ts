/** 纯日期字符串不经时区换算，避免统计日期和 Cron 固定偏移被控件改写。 */
export function validCalendarValue(value: string, withTime = false, seconds = false): boolean {
  const pattern = withTime
    ? seconds
      ? /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}$/
      : /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}$/
    : /^\d{4}-\d{2}-\d{2}$/
  if (!pattern.test(value) || Number(value.slice(0, 4)) < 100) return false
  const normalized = value.replace(' ', 'T')
  const date = new Date(`${normalized}${withTime ? (seconds ? '' : ':00') : 'T00:00:00'}Z`)
  return (
    Number.isFinite(date.getTime()) &&
    date.toISOString().slice(0, withTime ? (seconds ? 19 : 16) : 10) === normalized
  )
}

export function calendarDays(
  year: number,
  month: number
): Array<{ value: string; day: number; current: boolean }> {
  const first = new Date(Date.UTC(year, month, 1))
  const offset = (first.getUTCDay() + 6) % 7
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(Date.UTC(year, month, index - offset + 1))
    return {
      value: date.toISOString().slice(0, 10),
      day: date.getUTCDate(),
      current: date.getUTCMonth() === month
    }
  })
}

export function localDateValue(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
