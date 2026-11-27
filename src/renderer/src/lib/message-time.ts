/**
 * 消息气泡下方的时间文案。
 *
 * 同年省略年份，跨年补全年份；使用本机时区，分钟补零。
 * 时间无效时返回空串，由界面决定不渲染日期。
 */
export function formatMessageDateTime(timestampMs: number, now = Date.now()): string {
  if (!Number.isFinite(timestampMs)) return ''
  const date = new Date(timestampMs)
  if (Number.isNaN(date.getTime())) return ''

  const current = new Date(now)
  const sameYear = date.getFullYear() === current.getFullYear()
  const prefix = sameYear
    ? `${date.getMonth() + 1}月${date.getDate()}日`
    : `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${prefix} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}
