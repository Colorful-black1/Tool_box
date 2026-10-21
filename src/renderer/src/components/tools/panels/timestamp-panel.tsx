/**
 * 时间戳换算：时间戳 ↔ 本地日期时间。
 *
 * 模型与脚本里常见的时间戳（10 位秒 / 13 位毫秒）都能识别，
 * 也支持反过来把「2026-10-20 21:05:09」换算成时间戳。
 */
import { useMemo, useState } from 'react'
import type { JSX } from 'react'

import { formatTimestamp, parseDateTime, parseTimestamp } from '@shared/dev-tools'

export function TimestampPanel(): JSX.Element {
  const [stamp, setStamp] = useState('')
  const [dateText, setDateText] = useState('')

  const stampToDate = useMemo(() => {
    const ms = parseTimestamp(stamp)
    if (ms === null) return ''
    return formatTimestamp(ms)
  }, [stamp])

  const dateToStamp = useMemo(() => {
    const ms = parseDateTime(dateText)
    if (ms === null) return ''
    return String(ms)
  }, [dateText])

  return (
    <div className="tool-stack">
      <section className="tool-io">
        <header className="tool-io-head">
          <span className="tool-io-label">时间戳 → 日期时间</span>
          <button
            type="button"
            className="btn-ghost btn-mini"
            onClick={() => setStamp(String(Date.now()))}
          >
            填入现在
          </button>
        </header>
        <input
          className="field-input tool-input-line"
          type="text"
          value={stamp}
          aria-label="待转换的时间戳"
          placeholder="1760000000 或 1760000000000"
          spellCheck={false}
          onChange={(event) => setStamp(event.target.value)}
        />
        <output className="tool-result-line">{stampToDate || '—'}</output>
        {stamp.trim() && !stampToDate ? (
          <div className="tool-error" role="alert">
            请输入有效范围内的数字时间戳
          </div>
        ) : null}
      </section>

      <section className="tool-io">
        <header className="tool-io-head">
          <span className="tool-io-label">日期时间 → 时间戳</span>
        </header>
        <input
          className="field-input tool-input-line"
          type="text"
          value={dateText}
          aria-label="待转换的本地日期时间"
          placeholder="2026-10-20 21:05:09"
          spellCheck={false}
          onChange={(event) => setDateText(event.target.value)}
        />
        <output className="tool-result-line">{dateToStamp || '—'}</output>
        {dateText.trim() && !dateToStamp ? (
          <div className="tool-error" role="alert">
            请输入有效的本地日期时间，格式为 YYYY-MM-DD HH:mm:ss
          </div>
        ) : null}
      </section>
    </div>
  )
}
