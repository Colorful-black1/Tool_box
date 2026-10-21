/**
 * 文本统计与行处理：字数 / 行数 / 词数 / 段落数，外加几行常见的清洗动作。
 */
import { useMemo, useState } from 'react'
import type { JSX } from 'react'

import { dedupeLines, sortLines, textStats, trimLines } from '@shared/dev-tools'

import { Workbench } from '../workbench'

type TextOperation = 'dedupe' | 'asc' | 'desc' | 'trim'

export function TextPanel(): JSX.Element {
  const [input, setInput] = useState('')
  const [operation, setOperation] = useState<TextOperation | null>(null)

  const stats = useMemo(() => textStats(input), [input])
  const output = useMemo(() => {
    switch (operation) {
      case 'dedupe':
        return dedupeLines(input)
      case 'asc':
        return sortLines(input, 'asc')
      case 'desc':
        return sortLines(input, 'desc')
      case 'trim':
        return trimLines(input)
      default:
        return ''
    }
  }, [input, operation])

  return (
    <div className="tool-stack">
      <section className="tool-io">
        <header className="tool-io-head">
          <span className="tool-io-label">统计</span>
        </header>
        <div className="tool-stat-grid">
          <div className="tool-stat">
            <span className="tool-stat-value">{stats.chars}</span>
            <span className="tool-stat-label">字符</span>
          </div>
          <div className="tool-stat">
            <span className="tool-stat-value">{stats.charsNoSpace}</span>
            <span className="tool-stat-label">不含空白</span>
          </div>
          <div className="tool-stat">
            <span className="tool-stat-value">{stats.lines}</span>
            <span className="tool-stat-label">行</span>
          </div>
          <div className="tool-stat">
            <span className="tool-stat-value">{stats.words}</span>
            <span className="tool-stat-label">词</span>
          </div>
          <div className="tool-stat">
            <span className="tool-stat-value">{stats.paragraphs}</span>
            <span className="tool-stat-label">段落</span>
          </div>
        </div>
      </section>

      <Workbench
        inputLabel="文本"
        outputLabel="处理结果"
        value={input}
        onChange={setInput}
        output={output}
        placeholder="粘贴要统计的文本"
        actions={
          <>
            <button
              type="button"
              className="btn-ghost btn-mini"
              aria-pressed={operation === 'dedupe'}
              onClick={() => setOperation('dedupe')}
            >
              按行去重
            </button>
            <button
              type="button"
              className="btn-ghost btn-mini"
              aria-pressed={operation === 'asc'}
              onClick={() => setOperation('asc')}
            >
              升序
            </button>
            <button
              type="button"
              className="btn-ghost btn-mini"
              aria-pressed={operation === 'desc'}
              onClick={() => setOperation('desc')}
            >
              降序
            </button>
            <button
              type="button"
              className="btn-ghost btn-mini"
              aria-pressed={operation === 'trim'}
              onClick={() => setOperation('trim')}
            >
              去空白
            </button>
          </>
        }
      />
    </div>
  )
}
