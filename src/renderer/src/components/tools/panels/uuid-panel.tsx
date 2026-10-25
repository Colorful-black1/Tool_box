/**
 * UUID 生成器：一次生成若干条 v4 UUID。
 *
 * 数量可调（1 ~ 1000），结果一行一条，可以整份复制走。
 */
import { useEffect, useState } from 'react'
import type { JSX } from 'react'

import { generateUuidBatch } from '@shared/dev-tools'

import { CopyButton } from '../workbench'
import { AutoTextarea } from '../auto-textarea'
import { NumberStepper } from '../../number-stepper'

export function UuidPanel(): JSX.Element {
  const [count, setCount] = useState(5)
  const [output, setOutput] = useState('')
  const [error, setError] = useState('')

  const generate = (total: number): void => {
    try {
      setOutput(generateUuidBatch(total).join('\n'))
      setError('')
    } catch (generateError) {
      setOutput('')
      setError(generateError instanceof Error ? generateError.message : '生成失败')
    }
  }

  // 打开面板先给一批，省得对着空白面板
  useEffect(() => {
    generate(5)
  }, [])

  return (
    <div className="tool-stack">
      <section className="tool-io">
        <header className="tool-io-head">
          <span className="tool-io-label">生成数量</span>
          <span className="tool-io-actions">
            <NumberStepper min={1} max={1000} value={count} label="生成数量" onChange={setCount} />
            <button
              type="button"
              className="btn-ghost btn-mini"
              disabled={!Number.isInteger(count) || count < 1 || count > 1000}
              onClick={() => generate(count)}
            >
              生成
            </button>
            <CopyButton text={output} label="复制全部" />
          </span>
        </header>
        <p className="field-hint">UUID v4（RFC 4122），由本机安全随机数生成，不联网。</p>
      </section>

      {error ? (
        <div className="tool-error" role="alert">
          {error}
        </div>
      ) : null}

      <section className="tool-io">
        <header className="tool-io-head">
          <span className="tool-io-label">结果（{output ? output.split('\n').length : 0} 条）</span>
        </header>
        <AutoTextarea
          className="field-input field-textarea tool-input tool-output"
          value={output}
          readOnly
          placeholder="点「生成」"
        />
      </section>
    </div>
  )
}
