import { useState } from 'react'
import type { JSX } from 'react'
import { contrastRatio, parseColor } from '@shared/local-converters'
import { CopyButton } from '../workbench'

/** 输入即换算；样例色只出现在用户颜色预览，不改变应用主题。 */
export function ColorPanel(): JSX.Element {
  const [foreground, setForeground] = useState('rgb(0, 0, 0)')
  const [background, setBackground] = useState('rgb(255, 255, 255)')
  let result
  let error = ''
  try {
    const a = parseColor(foreground)
    const b = parseColor(background)
    result = { a, b, ratio: contrastRatio(a, b) }
  } catch (cause) {
    error = cause instanceof Error ? cause.message : '颜色无效'
  }
  return (
    <div className="tool-stack">
      <p className="field-hint">支持 HEX、RGB、HSL 不透明颜色；编辑任意一种格式即可转换。</p>
      <div className="converter-grid">
        {[
          { label: '前景色', text: foreground, set: setForeground, color: result?.a },
          { label: '背景色', text: background, set: setBackground, color: result?.b }
        ].map((item) => (
          <section className="tool-io" key={item.label}>
            <label className="field-label">
              {item.label}
              <input
                className="field-input"
                aria-label={item.label}
                value={item.text}
                maxLength={200}
                onChange={(event) => item.set(event.target.value)}
              />
            </label>
            {item.color
              ? [item.color.hex, item.color.rgb, item.color.hsl].map((value) => (
                  <div className="converter-result" key={value}>
                    <code>{value}</code>
                    <CopyButton
                      text={value}
                      label={`复制 ${item.label} ${value.startsWith('#') ? 'HEX' : value.startsWith('rgb') ? 'RGB' : 'HSL'}`}
                    />
                  </div>
                ))
              : null}
          </section>
        ))}
      </div>
      {error ? (
        <p className="status-banner" role="alert">
          {error}
        </p>
      ) : null}
      {result ? (
        <section className="tool-io">
          <div
            className="color-preview"
            style={{ color: result.a.hex, backgroundColor: result.b.hex }}
          >
            文字预览 Aa 你好 123
          </div>
          <p className="tool-result-line" aria-live="polite">
            对比度 {result.ratio.toFixed(2)}:1
          </p>
          <p className="field-hint">
            WCAG 2.x：普通文字 AA {result.ratio >= 4.5 ? '通过' : '未通过'} · AAA{' '}
            {result.ratio >= 7 ? '通过' : '未通过'} · 大号文字 AA{' '}
            {result.ratio >= 3 ? '通过' : '未通过'}
          </p>
        </section>
      ) : null}
    </div>
  )
}
