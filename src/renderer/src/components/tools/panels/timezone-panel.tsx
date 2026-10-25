import { useMemo, useState } from 'react'
import type { JSX } from 'react'
import { COMMON_TIMEZONES, formatInTimezone, zonedDateTimeToMs } from '@shared/timezone-tools'
import type { TimeDisambiguation } from '@shared/timezone-tools'
import { Dropdown } from '../../dropdown'
import { CopyButton } from '../workbench'

/** 让用户明确输入时间的来源时区，并处理夏令时重复／缺口。 */
export function TimezonePanel(): JSX.Element {
  const [text, setText] = useState('')
  const [source, setSource] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone)
  const [target, setTarget] = useState('UTC')
  const [choice, setChoice] = useState<TimeDisambiguation>('reject')
  const zones = useMemo(
    () =>
      [...new Set([source, target, ...COMMON_TIMEZONES, ...Intl.supportedValuesOf('timeZone')])]
        .sort()
        .map((zone) => ({ value: zone, label: zone })),
    [source, target]
  )
  let output = ''
  let error = ''
  if (text.trim()) {
    try {
      const ms = zonedDateTimeToMs(text, source, choice)
      output = `${formatInTimezone(ms, target)}\nUTC：${new Date(ms).toISOString()}\n毫秒时间戳：${ms}`
    } catch (cause) {
      error = cause instanceof Error ? cause.message : '时区换算失败'
    }
  }
  return (
    <section className="tool-io">
      <h3 className="tool-io-label">时区换算</h3>
      <div className="tool-controls">
        <Dropdown
          ariaLabel="源时区"
          value={source}
          options={zones}
          searchable
          onChange={setSource}
        />
        <button
          type="button"
          className="btn-ghost"
          aria-label="交换时区"
          onClick={() => {
            setSource(target)
            setTarget(source)
          }}
        >
          ⇄
        </button>
        <Dropdown
          ariaLabel="目标时区"
          value={target}
          options={zones}
          searchable
          onChange={setTarget}
        />
        <Dropdown
          ariaLabel="夏令时重复时间"
          value={choice}
          options={[
            { value: 'reject', label: '重复时间先提示' },
            { value: 'earlier', label: '选择较早时刻' },
            { value: 'later', label: '选择较晚时刻' }
          ]}
          onChange={(id) => setChoice(id as TimeDisambiguation)}
        />
      </div>
      <input
        className="field-input"
        aria-label="源时区日期时间"
        value={text}
        maxLength={19}
        placeholder="2026-10-25 09:00:00"
        onChange={(event) => setText(event.target.value)}
      />
      <p className="field-hint">按源时区输入日期时间；夏令时不存在的时间不会自动调整。</p>
      {error ? (
        <p className="tool-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="converter-result">
        <output className="tool-result-line timezone-output">{output || '—'}</output>
        <CopyButton text={output} label="复制时区结果" />
      </div>
    </section>
  )
}
