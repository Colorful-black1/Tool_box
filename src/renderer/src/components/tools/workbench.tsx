/**
 * 工具页的输入 / 输出工作台。
 *
 * 大多数开发者工具都是「一段文本进、一段文本出」，
 * 把左右两栏、标题、复制按钮、错误提示抽到这里，各工具只写自己的转换逻辑。
 */
import type { JSX, ReactNode } from 'react'
import { useState } from 'react'

import { useAppStore } from '../../stores/app-store'
import { AutoTextarea } from './auto-textarea'

export interface WorkbenchProps {
  /** 左侧输入区的标题 */
  inputLabel: string
  /** 右侧输出区的标题 */
  outputLabel: string
  /** 输入内容 */
  value: string
  onChange: (value: string) => void
  /** 输出内容（出错时可以为空） */
  output: string
  /** 流式预览尚未校验时禁用复制按钮。 */
  outputPending?: boolean
  /** 出错时的提示（已脱敏 / 可读） */
  error?: string
  /** 输入区占位文案 */
  placeholder?: string
  /** 输入区上方的额外控件（按钮组等） */
  actions?: ReactNode
  /** 右侧输出区的额外内容（统计卡片、命中列表等） */
  outputExtra?: ReactNode
  /** 单行输入模式（时间戳这类短输入用得到） */
  singleLine?: boolean
}

/** 一键复制：复制走主进程剪贴板，失败时给出提示 */
export function CopyButton({ text, label = '复制' }: { text: string; label?: string }): JSX.Element {
  const copyText = useAppStore((state) => state.copyText)
  const [feedback, setFeedback] = useState<{ text: string; status: 'ok' | 'fail' } | null>(null)
  const state = feedback?.text === text ? feedback.status : 'idle'

  return (
    <button
      type="button"
      className="btn-ghost btn-mini"
      disabled={!text}
      onClick={() => {
        void copyText(text)
          .then(() => setFeedback({ text, status: 'ok' }))
          .catch(() => setFeedback({ text, status: 'fail' }))
      }}
    >
      {state === 'ok' ? '已复制' : state === 'fail' ? '复制失败' : label}
    </button>
  )
}

export function Workbench({
  inputLabel,
  outputLabel,
  value,
  onChange,
  output,
  outputPending = false,
  error,
  placeholder,
  actions,
  outputExtra,
  singleLine = false
}: WorkbenchProps): JSX.Element {
  const [wrap, setWrap] = useState(false)

  return (
    <div className="tool-workbench">
      <section className="tool-io">
        <header className="tool-io-head">
          <span className="tool-io-label">{inputLabel}</span>
          <span className="tool-io-actions">
            {actions ? actions : null}
            <button
              type="button"
              className={`tool-segment-item${wrap ? ' active' : ''}`}
              aria-pressed={wrap}
              title="长行自动换行"
              onClick={() => setWrap((current) => !current)}
            >
              换行
            </button>
          </span>
        </header>
        {singleLine ? (
          <input
            className="field-input tool-input-line"
            type="text"
            value={value}
            placeholder={placeholder}
            aria-label={inputLabel}
            spellCheck={false}
            onChange={(event) => onChange(event.target.value)}
          />
        ) : (
          <AutoTextarea
            className="field-input field-textarea tool-input"
            value={value}
            placeholder={placeholder}
            ariaLabel={inputLabel}
            onChange={onChange}
            wrap={wrap}
          />
        )}
      </section>

      <section className="tool-io">
        <header className="tool-io-head">
          <span className="tool-io-label">{outputLabel}</span>
          <span className="tool-io-actions">
            <button
              type="button"
              className={`tool-segment-item${wrap ? ' active' : ''}`}
              aria-pressed={wrap}
              title="长行自动换行"
              onClick={() => setWrap((current) => !current)}
            >
              换行
            </button>
            <CopyButton text={outputPending ? '' : output} />
          </span>
        </header>
        {error ? (
          <div className="tool-error" role="alert">
            {error}
          </div>
        ) : null}
        {!error && outputExtra ? <div className="tool-extra">{outputExtra}</div> : null}
        <AutoTextarea
          className="field-input field-textarea tool-input tool-output"
          value={output}
          readOnly
          placeholder="结果会显示在这里"
          ariaLabel={outputLabel}
          wrap={wrap}
        />
      </section>
    </div>
  )
}
