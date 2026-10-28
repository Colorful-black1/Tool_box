import { useEffect, useRef } from 'react'
import type { JSX } from 'react'
import { validCalendarValue } from '../lib/calendar'

const KEY_STEPS: Record<string, number> = {
  ArrowUp: -3,
  ArrowDown: 3,
  ArrowLeft: -1,
  ArrowRight: 1
}

/** 弹层内的时分秒选择，不另开浮层，避免点击被外层日历判作外部点击。 */
interface TimePickerProps {
  value: string
  label: string
  seconds?: boolean
  onChange(value: string): void
  onConfirm(): void
}

/** 手动输入与分栏点选并存；时间始终按调用方指定的精度返回。 */
export function TimePicker({
  value,
  label,
  seconds = false,
  onChange,
  onConfirm
}: TimePickerProps): JSX.Element {
  const root = useRef<HTMLDivElement>(null)
  const columns = seconds ? ['时', '分', '秒'] : ['时', '分']
  const parts = value.split(':')
  const valid = validCalendarValue(`2000-01-01T${value}`, true, seconds)
  useEffect(() => {
    root.current
      ?.querySelector<HTMLButtonElement>('[aria-selected="true"]')
      ?.focus({ preventScroll: true })
  }, [])
  useEffect(() => {
    root.current?.querySelectorAll<HTMLElement>('[role="listbox"]').forEach((list) => {
      const selected = list.querySelector<HTMLElement>('[aria-selected="true"]')
      if (selected)
        list.scrollTop = selected.offsetTop - (list.clientHeight - selected.offsetHeight) / 2
    })
  }, [value])
  const choose = (column: number, next: number): void => {
    onChange(
      columns
        .map((_, index) => {
          if (index === column) return String(next).padStart(2, '0')
          const part = parts[index] ?? ''
          return /^\d{2}$/.test(part) && Number(part) < (index === 0 ? 24 : 60) ? part : '00'
        })
        .join(':')
    )
  }
  return (
    <div className="time-picker" ref={root}>
      <input
        className="field-input"
        aria-label={`${label}时刻`}
        value={value}
        aria-invalid={!valid}
        maxLength={seconds ? 8 : 5}
        placeholder={seconds ? 'HH:mm:ss' : 'HH:mm'}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
            event.preventDefault()
            if (!event.repeat && valid) onConfirm()
          }
        }}
      />
      <div className="time-picker-columns">
        {columns.map((unit, column) => {
          const count = column === 0 ? 24 : 60
          const selected = /^\d{2}$/.test(parts[column] ?? '') ? Number(parts[column]) : -1
          return (
            <div className="time-picker-column" key={unit}>
              <span className="field-label">{unit}</span>
              <div
                className="time-picker-options"
                role="listbox"
                aria-label={`${label}${column === 0 ? '小时' : column === 1 ? '分钟' : '秒'}`}
                onKeyDown={(event) => {
                  if (!(event.target instanceof HTMLButtonElement)) return
                  const buttons = [
                    ...event.currentTarget.querySelectorAll<HTMLButtonElement>('button')
                  ]
                  const current = buttons.indexOf(event.target)
                  const delta = KEY_STEPS[event.key]
                  const next =
                    event.key === 'Home'
                      ? 0
                      : event.key === 'End'
                        ? count - 1
                        : delta !== undefined
                          ? Math.max(0, Math.min(count - 1, current + delta))
                          : undefined
                  if (next === undefined) return
                  event.preventDefault()
                  choose(column, next)
                  buttons[next]?.focus({ preventScroll: true })
                }}
              >
                {Array.from({ length: count }, (_, number) => (
                  <button
                    type="button"
                    role="option"
                    key={number}
                    className="btn-ghost calendar-day"
                    aria-label={`${number}${unit}`}
                    aria-selected={selected === number}
                    tabIndex={
                      number === (selected >= 0 && selected < count ? selected : 0) ? 0 : -1
                    }
                    onClick={() => choose(column, number)}
                  >
                    {String(number).padStart(2, '0')}
                  </button>
                ))}
              </div>
            </div>
          )
        })}
      </div>
      {!valid ? (
        <p className="field-hint warn" role="alert">
          请输入有效的 24 小时时间，或点选时分。
        </p>
      ) : null}
    </div>
  )
}
