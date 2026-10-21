/**
 * 正则测试：实时列出所有命中及其位置。
 *
 * 只做「测试」，不做替换 —— 替换留给用户自己复制结果，
 * 免得一个正则把整段文本改坏却看不出来。
 */
import { useEffect, useState } from 'react'
import type { JSX } from 'react'

import type { RegexResult } from '@shared/dev-tools'

import { runRegex } from '../../../lib/regex-runner'
import { AutoTextarea } from '../auto-textarea'

export function RegexPanel(): JSX.Element {
  const [pattern, setPattern] = useState('')
  const [flags, setFlags] = useState('g')
  const [text, setText] = useState('')

  const [result, setResult] = useState<RegexResult>({ matches: [] })
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setResult({ matches: [] })
    setBusy(Boolean(pattern))
    if (!pattern) return
    const controller = new AbortController()
    // 连续输入时只测试最后一份内容，取消任务时不让旧结果覆盖新输入。
    const timer = setTimeout(() => {
      void runRegex(pattern, flags, text, controller.signal).then((next) => {
        if (controller.signal.aborted) return
        setResult(next)
        setBusy(false)
      })
    }, 150)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [pattern, flags, text])

  return (
    <div className="tool-regex">
      <div className="tool-regex-bar">
        <span className="tool-regex-slash">/</span>
        <input
          className="field-input tool-regex-input"
          type="text"
          value={pattern}
          placeholder="正则表达式，例如 \d{4}-\d{2}"
          aria-label="正则表达式"
          spellCheck={false}
          onChange={(event) => setPattern(event.target.value)}
        />
        <span className="tool-regex-slash">/</span>
        <input
          className="field-input tool-regex-flags"
          type="text"
          value={flags}
          maxLength={6}
          placeholder="gim"
          spellCheck={false}
          aria-label="正则标志"
          onChange={(event) => setFlags(event.target.value)}
        />
      </div>

      <section className="tool-io">
        <header className="tool-io-head">
          <span className="tool-io-label">测试文本</span>
          <span className="tool-io-hint">{text.length} 字</span>
        </header>
        <AutoTextarea
          className="field-input field-textarea tool-input"
          value={text}
          placeholder="粘贴要测试的文本"
          ariaLabel="正则测试文本"
          onChange={setText}
        />
      </section>

      {result.error ? (
        <div className="tool-error" role="alert">
          {result.error}
        </div>
      ) : null}

      {busy ? (
        <p className="tool-empty" role="status">
          正在测试…
        </p>
      ) : null}

      {!result.error && !busy ? (
        <section className="tool-io" aria-live="polite">
          <header className="tool-io-head">
            <span className="tool-io-label">命中 {result.matches.length} 处</span>
            <span className="tool-io-hint">最多显示 200 条</span>
          </header>
          {result.matches.length === 0 ? (
            <p className="tool-empty">
              {pattern ? '没有命中。检查一下表达式与标志位。' : '输入表达式与测试文本开始匹配。'}
            </p>
          ) : (
            <ul className="tool-match-list">
              {result.matches.map((match, index) => (
                <li key={`${match.index}-${index}`} className="tool-match-item">
                  <span className="tool-match-index">#{index + 1}</span>
                  <span className="tool-match-text">{match.text}</span>
                  <span className="tool-match-pos">位置 {match.index}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </div>
  )
}
