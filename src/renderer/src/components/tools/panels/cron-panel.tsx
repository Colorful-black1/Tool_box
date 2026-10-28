import { useState } from 'react'
import type { JSX } from 'react'
import { formatCronTime, parseCronStart, previewCron } from '@shared/cron-tools'
import type { CronDialect, CronPreview } from '@shared/cron-tools'
import { defaultCronFields, normalizeCronFields } from '@shared/cron-builder'
import type { CronFieldStates } from '@shared/cron-builder'
import { Dropdown } from '../../dropdown'
import { DatePicker } from '../../date-picker'
import { CopyButton } from '../workbench'
import { CronBuilder } from './cron-builder'

type CronMode = 'build' | 'parse'

export function CronPanel(): JSX.Element {
  const [mode, setMode] = useState<CronMode>('build')
  const [dialect, setDialect] = useState<CronDialect>('spring')
  const [expression, setExpression] = useState('0 0 9 * * MON-FRI')
  const [offset, setOffset] = useState(480)
  const [start, setStart] = useState(() => formatCronTime(Date.now(), 480).replace(' ', 'T'))
  const [result, setResult] = useState<CronPreview | null>(null)
  const [error, setError] = useState('')
  const [invalidStart, setInvalidStart] = useState(false)
  const [builderFields, setBuilderFields] = useState<CronFieldStates>(() =>
    defaultCronFields('spring')
  )
  const reset = (): void => {
    setResult(null)
    setError('')
  }
  const changeStart = (value: string): void => {
    reset()
    setStart(value)
  }
  const changeDialect = (value: CronDialect): void => {
    reset()
    setDialect(value)
    setBuilderFields((current) => normalizeCronFields(current, value))
  }
  const changeOffset = (next: number): void => {
    reset()
    try {
      setStart(formatCronTime(parseCronStart(start, offset), next).replace(' ', 'T'))
    } catch {
      /* 起点尚未填完整时保留输入，由计算按钮统一提示。 */
    }
    setOffset(next)
  }
  const calculate = (): void => {
    reset()
    try {
      setResult(previewCron(expression, dialect, parseCronStart(start, offset), offset))
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Cron 计算失败')
    }
  }
  const setExample = (): void => {
    reset()
    setExpression(
      dialect === 'unix'
        ? '0 9 * * MON-FRI'
        : dialect === 'quartz'
          ? '0 0 9 ? * MON-FRI'
          : '0 0 9 * * MON-FRI'
    )
  }
  /** 把生成结果带到解析页，并沿用当前起点立即算一次。 */
  const applyGenerated = (value: string): void => {
    reset()
    setExpression(value)
    setMode('parse')
    try {
      setResult(previewCron(value, dialect, parseCronStart(start, offset), offset))
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Cron 计算失败')
    }
  }
  return (
    <div className="tool-stack">
      <div className="tool-controls">
        <Dropdown
          ariaLabel="Cron 格式"
          value={dialect}
          options={[
            { value: 'spring', label: 'Spring · 六段' },
            { value: 'quartz', label: 'Quartz · 六/七段' },
            { value: 'unix', label: 'Unix · 五段' }
          ]}
          onChange={(value) => changeDialect(value as CronDialect)}
        />
        <Dropdown
          ariaLabel="Cron 时区"
          value={String(offset)}
          options={[
            { value: '480', label: '北京时间 · UTC+08:00' },
            { value: '0', label: 'UTC' }
          ]}
          onChange={(value) => changeOffset(Number(value))}
        />
        <span className="tool-segment" role="group" aria-label="Cron 模式">
          <button
            type="button"
            className={`tool-segment-item${mode === 'build' ? ' active' : ''}`}
            aria-pressed={mode === 'build'}
            onClick={() => setMode('build')}
          >
            可视化生成
          </button>
          <button
            type="button"
            className={`tool-segment-item${mode === 'parse' ? ' active' : ''}`}
            aria-pressed={mode === 'parse'}
            onClick={() => setMode('parse')}
          >
            表达式解析
          </button>
        </span>
      </div>
      {mode === 'parse' ? (
        <>
          <label className="field-label" htmlFor="cron-expression">
            Cron 表达式
          </label>
          <input
            id="cron-expression"
            className="field-input"
            value={expression}
            maxLength={256}
            spellCheck={false}
            onChange={(event) => {
              reset()
              setExpression(event.target.value)
            }}
          />
          <div className="tool-controls">
            <div className="tool-inline-field cron-inline-field">
              计算起点
              <DatePicker
                label="计算起点"
                withTime
                seconds
                value={start}
                onValidityChange={(valid) => setInvalidStart(!valid)}
                onChange={changeStart}
              />
            </div>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => changeStart(formatCronTime(Date.now(), offset).replace(' ', 'T'))}
            >
              从现在开始
            </button>
            <button type="button" className="btn-ghost" onClick={setExample}>
              工作日九点示例
            </button>
            <button
              type="button"
              className="btn-gold"
              disabled={invalidStart}
              onClick={calculate}
            >
              计算执行时间
            </button>
          </div>
          <p className="field-hint">
            仅预览，不创建任务。支持 * , - /；Spring / Quartz 另支持 ? L W #，Spring 支持 @daily
            等宏。 Unix 的受限日期与星期满足其一，Spring 同时满足，Quartz 必须有一个 ?。
            首版仅提供以上两个固定时区，不涉及夏令时。
          </p>
          {error ? (
            <div className="status-banner" role="alert">
              {error}
            </div>
          ) : null}
          {result ? (
            <>
              <div className="tool-diff">
                <table className="tool-ip-table" aria-label="Cron 字段说明">
                  <thead>
                    <tr>
                      <th>字段</th>
                      <th>表达式</th>
                      <th>含义</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.fields.map((field) => (
                      <tr key={field.name}>
                        <td>{field.name}</td>
                        <td>
                          <code>{field.value}</code>
                        </td>
                        <td>{field.meaning}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <section className="tool-io">
                <header className="tool-io-head">
                  <span className="tool-io-label">接下来十次执行时间</span>
                  <CopyButton
                    text={result.times.map((time) => formatCronTime(time, offset)).join('\n')}
                  />
                </header>
                <ol className="tool-cron-times" aria-label="执行时间">
                  {result.times.map((time) => (
                    <li key={time}>
                      <time dateTime={new Date(time).toISOString()}>
                        {formatCronTime(time, offset)} {offset ? '+08:00' : 'UTC'}
                      </time>
                    </li>
                  ))}
                </ol>
                {result.limited ? (
                  <p className="field-hint" role="status">
                    未来八年内仅找到 {result.times.length} 次匹配，未列出的时间不代表永不执行。
                  </p>
                ) : null}
              </section>
            </>
          ) : null}
        </>
      ) : (
        <CronBuilder
          dialect={dialect}
          offset={offset}
          start={start}
          fields={builderFields}
          onStartChange={changeStart}
          onStartValidityChange={setInvalidStart}
          onFieldsChange={setBuilderFields}
          onUseExpression={applyGenerated}
        />
      )}
    </div>
  )
}
