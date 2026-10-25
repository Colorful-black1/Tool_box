import { useState } from 'react'
import type { JSX } from 'react'
import { convertRadix, convertUnit, UNIT_GROUPS } from '@shared/local-converters'
import type { UnitGroup } from '@shared/local-converters'
import { Dropdown } from '../../dropdown'
import { CopyButton } from '../workbench'

function conversion(action: () => string): { output: string; error?: string } {
  try {
    return { output: action() }
  } catch (error) {
    return { output: '', error: error instanceof Error ? error.message : '换算失败' }
  }
}

/** 单位与进制共享入口，选项由有界白名单提供。 */
export function ConverterPanel(): JSX.Element {
  const [group, setGroup] = useState<UnitGroup>('data')
  const [from, setFrom] = useState('MiB')
  const [to, setTo] = useState('MB')
  const [value, setValue] = useState('1')
  const [integer, setInteger] = useState('')
  const [fromBase, setFromBase] = useState(10)
  const [toBase, setToBase] = useState(16)
  const result = conversion(() => convertUnit(value, group, from, to))
  const radix = conversion(() => convertRadix(integer, fromBase, toBase))
  const units = UNIT_GROUPS[group].units.map(([id, label]) => ({ value: id, label }))
  const bases = Array.from({ length: 35 }, (_, index) => ({
    value: String(index + 2),
    label: `${index + 2} 进制`
  }))
  return (
    <div className="tool-stack">
      <section className="tool-io">
        <h3 className="tool-io-label">单位换算</h3>
        <div className="tool-controls">
          <Dropdown
            ariaLabel="单位类别"
            value={group}
            options={Object.entries(UNIT_GROUPS).map(([id, item]) => ({
              value: id,
              label: item.label
            }))}
            onChange={(id) => {
              const next = id as UnitGroup
              setGroup(next)
              setFrom(UNIT_GROUPS[next].units[0][0])
              setTo(UNIT_GROUPS[next].units[1][0])
            }}
          />
          <Dropdown ariaLabel="源单位" value={from} options={units} onChange={setFrom} />
          <button
            type="button"
            className="btn-ghost"
            aria-label="交换单位"
            onClick={() => {
              setFrom(to)
              setTo(from)
            }}
          >
            ⇄
          </button>
          <Dropdown ariaLabel="目标单位" value={to} options={units} onChange={setTo} />
        </div>
        <input
          className="field-input"
          aria-label="待换算数值"
          value={value}
          maxLength={200}
          onChange={(event) => setValue(event.target.value)}
          placeholder="输入数字"
        />
        <div className="converter-result">
          <output className="tool-result-line">{result.output || '—'}</output>
          <CopyButton text={result.output} label="复制单位结果" />
        </div>
        {result.error ? (
          <p className="tool-error" role="alert">
            {result.error}
          </p>
        ) : null}
        <p className="field-hint">单位结果最多保留 12 位有效数字；KB = 1000 B，KiB = 1024 B。</p>
      </section>
      <section className="tool-io">
        <h3 className="tool-io-label">整数进制换算</h3>
        <div className="tool-controls">
          <Dropdown
            ariaLabel="源进制"
            value={String(fromBase)}
            options={bases}
            searchable
            onChange={(id) => setFromBase(Number(id))}
          />
          <button
            type="button"
            className="btn-ghost"
            aria-label="交换进制"
            onClick={() => {
              setFromBase(toBase)
              setToBase(fromBase)
            }}
          >
            ⇄
          </button>
          <Dropdown
            ariaLabel="目标进制"
            value={String(toBase)}
            options={bases}
            searchable
            onChange={(id) => setToBase(Number(id))}
          />
        </div>
        <input
          className="field-input"
          aria-label="待换算整数"
          value={integer}
          maxLength={4096}
          onChange={(event) => setInteger(event.target.value)}
          placeholder="输入整数，不带 0x / 0b 前缀"
        />
        <div className="converter-result">
          <output className="tool-result-line">{radix.output || '—'}</output>
          <CopyButton text={radix.output} label="复制进制结果" />
        </div>
        {radix.error ? (
          <p className="tool-error" role="alert">
            {radix.error}
          </p>
        ) : null}
        <p className="field-hint">支持负数和大整数，不经过浮点数转换。</p>
      </section>
    </div>
  )
}
