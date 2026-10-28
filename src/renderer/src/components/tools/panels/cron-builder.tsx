import { useMemo, useState } from 'react'
import type { JSX } from 'react'
import type { DropdownOption } from '../../dropdown'
import { Dropdown } from '../../dropdown'
import { DatePicker } from '../../date-picker'
import { CopyButton } from '../workbench'
import {
  CRON_BUILDER_FIELDS,
  CRON_WEEKDAYS,
  buildCronExpression,
  cronFieldsFromTime,
  visibleCronFields
} from '@shared/cron-builder'
import type {
  CronFieldKey,
  CronFieldMode,
  CronFieldState,
  CronFieldStates
} from '@shared/cron-builder'
import type { CronDialect } from '@shared/cron-tools'
import { formatCronTime, parseCronStart, previewCron } from '@shared/cron-tools'

const EVERY_LABEL: Record<CronFieldKey, string> = {
  second: '每秒',
  minute: '每分钟',
  hour: '每小时',
  day: '每日',
  month: '每月',
  week: '每周',
  year: '每年'
}

const WEEKDAY_VALUES: string[] = CRON_WEEKDAYS.map((day) => day.value)

function modeOptions(key: CronFieldKey, dialect: CronDialect): DropdownOption[] {
  const options: DropdownOption[] = [
    { value: 'every', label: EVERY_LABEL[key] },
    { value: 'range', label: '范围' },
    { value: 'step', label: '间隔' },
    { value: 'list', label: '指定' }
  ]
  if (dialect === 'quartz' && (key === 'day' || key === 'week'))
    options.push({ value: 'unspecified', label: '不指定' })
  return options
}

function WeekdaySelect({
  label,
  value,
  onChange
}: {
  label: string
  value: string
  onChange(value: string): void
}): JSX.Element {
  return (
    <Dropdown
      ariaLabel={label}
      value={value}
      options={CRON_WEEKDAYS.map((day) => ({ value: day.value, label: day.label }))}
      onChange={onChange}
      triggerClassName="cron-builder-week"
    />
  )
}

function NumberInput({
  label,
  value,
  min,
  max,
  onChange
}: {
  label: string
  value: string
  min: number
  max: number
  onChange(value: string): void
}): JSX.Element {
  return (
    <input
      className="field-input cron-builder-number"
      type="number"
      min={min}
      max={max}
      step={1}
      value={value}
      aria-label={label}
      onChange={(event) => onChange(event.target.value)}
    />
  )
}

interface CronBuilderProps {
  dialect: CronDialect
  offset: number
  start: string
  fields: CronFieldStates
  onStartChange(value: string): void
  onStartValidityChange(valid: boolean): void
  onFieldsChange(fields: CronFieldStates): void
  onUseExpression(expression: string): void
}

/** 逐字段生成 Cron：每/范围/间隔/指定，修改后实时预览未来十次执行时间。 */
export function CronBuilder(props: CronBuilderProps): JSX.Element {
  const [target, setTarget] = useState(() =>
    formatCronTime(Date.now(), props.offset).replace(' ', 'T')
  )
  const [quickError, setQuickError] = useState('')

  const built = useMemo(() => {
    try {
      return { expression: buildCronExpression(props.dialect, props.fields), error: '' }
    } catch (error) {
      return {
        expression: '',
        error: error instanceof Error ? error.message : '生成表达式失败'
      }
    }
  }, [props.dialect, props.fields])

  const preview = useMemo(() => {
    if (!built.expression) return { times: [], limited: false, error: '' }
    try {
      const result = previewCron(
        built.expression,
        props.dialect,
        parseCronStart(props.start, props.offset),
        props.offset
      )
      return { times: result.times, limited: result.limited, error: '' }
    } catch (error) {
      return {
        times: [],
        limited: false,
        error: error instanceof Error ? error.message : '计算执行时间失败'
      }
    }
  }, [built.expression, props.dialect, props.start, props.offset])

  const fillFromTime = (): void => {
    try {
      props.onFieldsChange(
        cronFieldsFromTime(parseCronStart(target, props.offset), props.dialect, props.offset)
      )
      setQuickError('')
    } catch (error) {
      setQuickError(error instanceof Error ? error.message : '填入时刻失败')
    }
  }

  const updateField = (key: CronFieldKey, patch: Partial<CronFieldState>): void => {
    const next: CronFieldStates = {
      ...props.fields,
      [key]: { ...props.fields[key], ...patch }
    }
    // Quartz 必须且只能有一个问号；优先保留另一侧的具体条件，把通用的“每”改成“不指定”。
    if (props.dialect === 'quartz') {
      const daySet = next.day.mode !== 'unspecified'
      const weekSet = next.week.mode !== 'unspecified'
      if (key === 'day') {
        if (daySet && weekSet) {
          if (next.day.mode === 'every') next.day = { ...next.day, mode: 'unspecified' }
          else next.week = { ...next.week, mode: 'unspecified' }
        } else if (!daySet && !weekSet) {
          next.week = { ...next.week, mode: 'every' }
        }
      } else if (key === 'week') {
        if (daySet && weekSet) {
          if (next.week.mode === 'every') next.week = { ...next.week, mode: 'unspecified' }
          else next.day = { ...next.day, mode: 'unspecified' }
        } else if (!daySet && !weekSet) {
          next.day = { ...next.day, mode: 'every' }
        }
      }
    }
    props.onFieldsChange(next)
  }

  const toggleWeekday = (key: CronFieldKey, value: string): void => {
    const current = props.fields[key].list
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
    const next = current.includes(value)
      ? current.filter((item) => item !== value)
      : [...current, value]
    next.sort((a, b) => WEEKDAY_VALUES.indexOf(a) - WEEKDAY_VALUES.indexOf(b))
    updateField(key, { list: next.join(',') })
  }

  const renderValue = (key: CronFieldKey, field: CronFieldState): JSX.Element => {
    const meta = CRON_BUILDER_FIELDS[key]
    if (field.mode === 'every')
      return <span className="cron-builder-text">所有取值</span>
    if (field.mode === 'unspecified')
      return <span className="cron-builder-text">不指定（?）</span>
    if (field.mode === 'list') {
      if (key === 'week')
        return (
          <span className="cron-builder-weekdays" role="group" aria-label="指定星期">
            {CRON_WEEKDAYS.map((day) => {
              const selected = field.list
                .split(',')
                .map((item) => item.trim())
                .includes(day.value)
              return (
                <button
                  key={day.value}
                  type="button"
                  className="btn-ghost btn-mini"
                  aria-pressed={selected}
                  onClick={() => toggleWeekday(key, day.value)}
                >
                  {day.label}
                </button>
              )
            })}
          </span>
        )
      return (
        <>
          <input
            className="field-input cron-builder-list"
            value={field.list}
            placeholder={meta.placeholder}
            aria-label={`${meta.label}指定值`}
            spellCheck={false}
            onChange={(event) => updateField(key, { list: event.target.value })}
          />
          <span className="cron-builder-text">逗号分隔</span>
        </>
      )
    }
    if (field.mode === 'range') {
      if (key === 'week')
        return (
          <>
            <WeekdaySelect
              label={`${meta.label}范围开始`}
              value={field.from}
              onChange={(value) => updateField(key, { from: value })}
            />
            <span className="cron-builder-text">–</span>
            <WeekdaySelect
              label={`${meta.label}范围结束`}
              value={field.to}
              onChange={(value) => updateField(key, { to: value })}
            />
          </>
        )
      return (
        <>
          <NumberInput
            label={`${meta.label}范围开始`}
            value={field.from}
            min={meta.min}
            max={meta.max}
            onChange={(value) => updateField(key, { from: value })}
          />
          <span className="cron-builder-text">–</span>
          <NumberInput
            label={`${meta.label}范围结束`}
            value={field.to}
            min={meta.min}
            max={meta.max}
            onChange={(value) => updateField(key, { to: value })}
          />
        </>
      )
    }
    const stepMax = key === 'week' ? 7 : meta.max - meta.min + 1
    return (
      <>
        <span className="cron-builder-text">从</span>
        {key === 'week' ? (
          <WeekdaySelect
            label={`${meta.label}间隔起点`}
            value={field.start}
            onChange={(value) => updateField(key, { start: value })}
          />
        ) : (
          <NumberInput
            label={`${meta.label}间隔起点`}
            value={field.start}
            min={meta.min}
            max={meta.max}
            onChange={(value) => updateField(key, { start: value })}
          />
        )}
        <span className="cron-builder-text">每</span>
        <NumberInput
          label={`${meta.label}间隔值`}
          value={field.step}
          min={1}
          max={stepMax}
          onChange={(value) => updateField(key, { step: value })}
        />
        <span className="cron-builder-text">{key === 'week' ? '个取值' : meta.unit}</span>
      </>
    )
  }

  return (
    <div className="tool-stack">
      <div className="tool-controls">
        <div className="tool-inline-field cron-inline-field">
          快速填入
          <DatePicker
            label="快速填入时刻"
            withTime
            seconds
            min="1970-01-01T00:00:00"
            max="2099-12-31T23:59:59"
            value={target}
            onChange={setTarget}
          />
        </div>
        <button type="button" className="btn-ghost" onClick={fillFromTime}>
          填入时刻
        </button>
      </div>
      <div className="tool-controls">
        <div className="tool-inline-field cron-inline-field">
          计算起点
          <DatePicker
            label="计算起点"
            withTime
            seconds
            value={props.start}
            onValidityChange={props.onStartValidityChange}
            onChange={props.onStartChange}
          />
        </div>
        <button
          type="button"
          className="btn-ghost"
          onClick={() =>
            props.onStartChange(formatCronTime(Date.now(), props.offset).replace(' ', 'T'))
          }
        >
          从现在开始
        </button>
      </div>
      {quickError ? (
        <div className="tool-error" role="alert">
          {quickError}
        </div>
      ) : null}
      <p className="field-hint">
        按年月日时分秒快速填入后，可把需要重复的字段改成范围、间隔或指定；修改后实时生成表达式。
      </p>
      <div className="cron-builder">
        {visibleCronFields(props.dialect).map((key) => {
          const meta = CRON_BUILDER_FIELDS[key]
          const field = props.fields[key]
          return (
            <div className="cron-builder-row" key={key}>
              <span className="cron-builder-label">{meta.label}</span>
              <Dropdown
                ariaLabel={`${meta.label}模式`}
                value={field.mode}
                options={modeOptions(key, props.dialect)}
                onChange={(value) => updateField(key, { mode: value as CronFieldMode })}
                triggerClassName="cron-builder-mode"
              />
              {renderValue(key, field)}
            </div>
          )
        })}
      </div>
      {props.dialect === 'quartz' ? (
        <p className="field-hint">
          Quartz 的日与周必须有一个为「不指定」，切换时会自动调整另一个；L、W、# 等特殊写法可在「表达式解析」中直接输入。
        </p>
      ) : null}
      {props.dialect === 'unix' ? (
        <p className="field-hint">Unix 没有秒和年；日与周同时受限时按“满足其一”计算。</p>
      ) : null}
      {props.dialect === 'spring' ? (
        <p className="field-hint">Spring 没有年字段；日与周同时受限时需同时满足。</p>
      ) : null}
      <section className="tool-io">
        <header className="tool-io-head">
          <span className="tool-io-label">生成的 Cron 表达式</span>
          <div className="tool-io-actions">
            <CopyButton text={built.expression} />
            <button
              type="button"
              className="btn-ghost btn-mini"
              disabled={!built.expression}
              onClick={() => props.onUseExpression(built.expression)}
            >
              填入表达式并计算
            </button>
          </div>
        </header>
        <output className="tool-result-line" aria-label="生成的 Cron 表达式">
          {built.expression || '—'}
        </output>
        {built.error ? (
          <div className="tool-error" role="alert">
            {built.error}
          </div>
        ) : null}
      </section>
      {built.expression ? (
        <section className="tool-io">
          <header className="tool-io-head">
            <span className="tool-io-label">接下来十次执行时间</span>
            <CopyButton
              text={preview.times.map((time) => formatCronTime(time, props.offset)).join('\n')}
            />
          </header>
          {preview.error ? <p className="field-hint warn">{preview.error}</p> : null}
          {preview.times.length ? (
            <ol className="tool-cron-times" aria-label="生成执行时间">
              {preview.times.map((time) => (
                <li key={time}>
                  <time dateTime={new Date(time).toISOString()}>
                    {formatCronTime(time, props.offset)} {props.offset ? '+08:00' : 'UTC'}
                  </time>
                </li>
              ))}
            </ol>
          ) : null}
          {preview.limited ? (
            <p className="field-hint" role="status">
              {preview.times.length
                ? `未来八年内仅找到 ${preview.times.length} 次匹配，未列出的时间不代表永不执行。`
                : '未来八年内没有匹配时间。'}
            </p>
          ) : null}
        </section>
      ) : null}
      <p className="field-hint">
        仅生成表达式并预览，不创建任务；间隔写法为“起点/步长”，例如 0/15 表示从 0 开始每 15 个单位。
      </p>
    </div>
  )
}
