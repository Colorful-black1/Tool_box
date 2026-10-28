import { useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import { calendarDays, localDateValue, validCalendarValue } from '../lib/calendar'
import { Popover } from './popover'
import { CalendarIcon } from './icons'
import { TimePicker } from './time-picker'

/** 墙上日期与时刻输入，时区转换由调用方处理。 */
interface DatePickerProps {
  value: string
  onChange(value: string): void
  label: string
  withTime?: boolean
  /** 启用先选日期、再点选时分、确认提交的交互。 */
  selectTime?: boolean
  seconds?: boolean
  min?: string
  max?: string
  disabled?: boolean
  onValidityChange?(valid: boolean): void
}

/** 日期选择与直接输入并存，日历只提交明确日期，时间精度由业务指定。 */
export function DatePicker({
  value,
  onChange,
  label,
  withTime = false,
  selectTime = false,
  seconds = false,
  min,
  max,
  disabled = false,
  onValidityChange
}: DatePickerProps): JSX.Element {
  const [text, setText] = useState(value.replace('T', ' '))
  const [open, setOpen] = useState(false)
  const [month, setMonth] = useState(() => (value || localDateValue()).slice(0, 7))
  const [time, setTime] = useState(() => value.slice(11) || (seconds ? '09:00:00' : '09:00'))
  const [error, setError] = useState('')
  const [calendarDate, setCalendarDate] = useState('')
  const [view, setView] = useState<'date' | 'time'>('date')
  const pickingTime = withTime && selectTime
  const anchor = useRef<HTMLButtonElement>(null)
  const grid = useRef<HTMLDivElement>(null)
  const validity = useRef(onValidityChange)
  useEffect(() => {
    validity.current = onValidityChange
  }, [onValidityChange])
  useEffect(() => {
    setText(value.replace('T', ' '))
    setError('')
    validity.current?.(true)
  }, [value])
  useEffect(() => {
    if (disabled) setOpen(false)
  }, [disabled])
  const permitted = (candidate: string): boolean =>
    (!min || candidate >= min) && (!max || candidate <= max)
  const canConfirmTime =
    validCalendarValue(`${calendarDate}T${time}`, true, seconds) &&
    permitted(`${calendarDate}T${time}`)
  const submit = (candidate: string): boolean => {
    if (!candidate) {
      setError('')
      onValidityChange?.(true)
      onChange('')
      return true
    }
    if (!validCalendarValue(candidate, withTime, seconds)) {
      setError(withTime ? '请输入有效日期时间' : '请输入有效日期')
      onValidityChange?.(false)
      return false
    }
    if (!permitted(candidate.replace(' ', 'T'))) {
      setError('日期超出允许范围')
      onValidityChange?.(false)
      return false
    }
    setError('')
    onValidityChange?.(true)
    onChange(candidate.replace(' ', 'T'))
    return true
  }
  const commitDay = (day: string, confirm = false): void => {
    if (pickingTime && !confirm) {
      setCalendarDate(day)
      setMonth(day.slice(0, 7))
      setView('time')
      return
    }
    const candidate = day + (withTime ? `T${time}` : '')
    if (submit(candidate)) {
      setText(candidate.replace('T', ' '))
      setOpen(false)
      anchor.current?.focus()
    }
  }
  const moveMonth = (delta: number, focusDay = false): void => {
    const [year, currentMonth] = month.split('-').map(Number)
    const date = new Date(Date.UTC(year, currentMonth - 1 + delta, 1))
    if (date.getUTCFullYear() >= 100 && date.getUTCFullYear() <= 9999) {
      setMonth(date.toISOString().slice(0, 7))
      if (focusDay) {
        const lastDay = new Date(
          Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)
        ).getUTCDate()
        date.setUTCDate(Math.min(Number(calendarDate.slice(8)) || 1, lastDay))
        const next = date.toISOString().slice(0, 10)
        setCalendarDate(next)
        requestAnimationFrame(() =>
          grid.current?.querySelector<HTMLElement>(`[data-date="${next}"]:not(:disabled)`)?.focus()
        )
      }
    }
  }
  const [year, currentMonth] = month.split('-').map(Number)
  const days = calendarDays(year, currentMonth - 1)
  return (
    <div className="date-picker">
      <div className={`date-picker-field${error ? ' invalid' : ''}`}>
        <input
          className="field-input"
          type="text"
          aria-label={label}
          aria-invalid={!!error}
          value={text}
          disabled={disabled}
          placeholder={withTime ? (seconds ? '年-月-日 时:分:秒' : '年-月-日 时:分') : '年-月-日'}
          maxLength={withTime ? (seconds ? 19 : 16) : 10}
          onChange={(event) => {
            const next = event.target.value
            setText(next)
            setError('')
            if (!next || validCalendarValue(next, withTime, seconds)) submit(next)
            else onValidityChange?.(false)
          }}
          onBlur={() => {
            if (text !== value.replace('T', ' ')) submit(text)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              submit(text)
            }
          }}
        />
        <button
          type="button"
          ref={anchor}
          className="icon-btn date-picker-trigger"
          aria-label={`选择${label}`}
          aria-haspopup="dialog"
          aria-expanded={open}
          disabled={disabled}
          onClick={() => {
            if (!open) {
              setView('date')
              setMonth((value || localDateValue()).slice(0, 7))
              setTime(value.slice(11) || (seconds ? '09:00:00' : '09:00'))
              setCalendarDate(value.slice(0, 10) || localDateValue())
            }
            setOpen(!open)
          }}
        >
          <CalendarIcon />
        </button>
      </div>
      {error ? (
        <span className="field-hint warn" role="alert">
          {error}
        </span>
      ) : null}
      {open ? (
        <Popover
          anchor={anchor}
          onClose={() => setOpen(false)}
          onReady={() =>
            (
              grid.current?.querySelector<HTMLElement>('[tabindex="0"]:not(:disabled)') ??
              grid.current?.querySelector<HTMLElement>('button:not(:disabled)')
            )?.focus()
          }
          align="right"
          className="calendar-popover"
          maxPanelHeight={480}
        >
          <section
            role="dialog"
            aria-label={`${label}日历`}
            onKeyDown={(event) => {
              if (event.key === 'Tab') {
                const controls = [
                  ...event.currentTarget.querySelectorAll<HTMLElement>(
                    'button:not(:disabled):not([tabindex="-1"]), input:not(:disabled)'
                  )
                ].filter((element) => element.getClientRects().length > 0)
                if (event.shiftKey && document.activeElement === controls[0]) {
                  event.preventDefault()
                  controls[controls.length - 1]?.focus()
                } else if (
                  !event.shiftKey &&
                  document.activeElement === controls[controls.length - 1]
                ) {
                  event.preventDefault()
                  controls[0]?.focus()
                }
              }
              if (
                (!pickingTime || view === 'date') &&
                (event.key === 'PageUp' || event.key === 'PageDown')
              ) {
                event.preventDefault()
                moveMonth(event.key === 'PageUp' ? -1 : 1, true)
              }
            }}
          >
            {pickingTime ? (
              <div className="calendar-mode-switch" role="group" aria-label="选择日期或时间">
                <button
                  type="button"
                  className="btn-ghost"
                  aria-pressed={view === 'date'}
                  onClick={() => setView('date')}
                >
                  日期 {calendarDate}
                </button>
                <button
                  type="button"
                  className="btn-ghost"
                  aria-pressed={view === 'time'}
                  onClick={() => setView('time')}
                >
                  时间 {time}
                </button>
              </div>
            ) : null}
            <div hidden={pickingTime && view === 'time'}>
              <header className="calendar-head">
                <button
                  type="button"
                  className="btn-ghost btn-mini"
                  aria-label="上个月"
                  onClick={() => moveMonth(-1)}
                >
                  上一月
                </button>
                <strong>
                  {year} 年 {currentMonth} 月
                </strong>
                <button
                  type="button"
                  className="btn-ghost btn-mini"
                  aria-label="下个月"
                  onClick={() => moveMonth(1)}
                >
                  下一月
                </button>
              </header>
              <div
                className="calendar-grid"
                ref={grid}
                role="grid"
                aria-label="日期"
                onKeyDown={(event) => {
                  const steps: Record<string, number> = {
                    ArrowLeft: -1,
                    ArrowRight: 1,
                    ArrowUp: -7,
                    ArrowDown: 7
                  }
                  const delta = steps[event.key]
                  if (delta === undefined || !(event.target instanceof HTMLElement)) return
                  const day = event.target.dataset.date
                  if (!day) return
                  event.preventDefault()
                  const date = new Date(`${day}T00:00:00Z`)
                  date.setUTCDate(date.getUTCDate() + delta)
                  const next = date.toISOString().slice(0, 10)
                  if (
                    !validCalendarValue(next) ||
                    (min && next < min.slice(0, 10)) ||
                    (max && next > max.slice(0, 10))
                  )
                    return
                  setCalendarDate(next)
                  setMonth(next.slice(0, 7))
                  requestAnimationFrame(() =>
                    grid.current?.querySelector<HTMLElement>(`[data-date="${next}"]`)?.focus()
                  )
                }}
              >
                <div role="row">
                  {['一', '二', '三', '四', '五', '六', '日'].map((day) => (
                    <span key={day} role="columnheader">
                      {day}
                    </span>
                  ))}
                </div>
                {Array.from({ length: 6 }, (_, week) => (
                  <div role="row" key={week}>
                    {days.slice(week * 7, week * 7 + 7).map((day) => (
                      <button
                        type="button"
                        role="gridcell"
                        key={day.value}
                        data-date={day.value}
                        aria-label={day.value}
                        aria-selected={
                          day.value === (pickingTime ? calendarDate : value.slice(0, 10))
                        }
                        className={`btn-ghost calendar-day${day.current ? '' : ' muted'}${day.value === (pickingTime ? calendarDate : value.slice(0, 10)) ? ' selected' : ''}${day.value === localDateValue() ? ' today' : ''}`}
                        tabIndex={day.value === calendarDate ? 0 : -1}
                        disabled={
                          !validCalendarValue(day.value) ||
                          (!!min && day.value < min.slice(0, 10)) ||
                          (!!max && day.value > max.slice(0, 10))
                        }
                        onFocus={() => setCalendarDate(day.value)}
                        onClick={() => commitDay(day.value)}
                      >
                        {day.day}
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            </div>
            {pickingTime && view === 'time' ? (
              <TimePicker
                value={time}
                label={label}
                seconds={seconds}
                onChange={setTime}
                onConfirm={() => {
                  if (canConfirmTime) commitDay(calendarDate, true)
                }}
              />
            ) : null}
            {withTime && !pickingTime ? (
              <div className="calendar-time">
                时间
                <input
                  className="field-input"
                  type="text"
                  aria-label={`${label}时刻`}
                  value={time}
                  maxLength={seconds ? 8 : 5}
                  placeholder={seconds ? 'HH:mm:ss' : 'HH:mm'}
                  onChange={(event) => setTime(event.target.value)}
                />
                <button
                  type="button"
                  className="btn-ghost btn-mini"
                  disabled={!value}
                  onClick={() => commitDay(value.slice(0, 10))}
                >
                  应用时间
                </button>
              </div>
            ) : null}
            <footer className="calendar-footer">
              <button
                type="button"
                className="btn-ghost btn-mini"
                onClick={() => commitDay(localDateValue())}
              >
                今天
              </button>
              <button
                type="button"
                className="btn-ghost btn-mini"
                onClick={() => {
                  submit('')
                  setText('')
                  setOpen(false)
                  anchor.current?.focus()
                }}
              >
                清空
              </button>
              {pickingTime ? (
                <button
                  type="button"
                  className="btn-gold btn-mini"
                  aria-label={`确认${label}`}
                  disabled={!canConfirmTime}
                  onClick={() => commitDay(calendarDate, true)}
                >
                  确认
                </button>
              ) : null}
            </footer>
            <p className="field-hint">
              {pickingTime
                ? '选日期后点选时、分，再确认；也可直接输入时间。'
                : withTime
                  ? '先填时间，再选日期；也可直接键入完整日期时间。'
                  : '支持直接键入日期，方向键移动，Enter 选择。'}
            </p>
          </section>
        </Popover>
      ) : null}
    </div>
  )
}
