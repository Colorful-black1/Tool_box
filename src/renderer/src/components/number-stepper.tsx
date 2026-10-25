import type { JSX } from 'react'

/** 有界整数步进器，允许保留暂时无效的键入值。 */
interface NumberStepperProps {
  value: number
  min: number
  max: number
  label: string
  onChange(value: number): void
}

/** 保留原生数值输入的校验与方向键，按钮只负责单步增减。 */
export function NumberStepper({
  value,
  min,
  max,
  label,
  onChange
}: NumberStepperProps): JSX.Element {
  const valid = Number.isInteger(value) && value >= min && value <= max
  return (
    <div className="number-stepper">
      <button
        type="button"
        className="icon-btn"
        aria-label={`减少${label}`}
        disabled={valid && value <= min}
        onClick={() => onChange(valid ? value - 1 : min)}
      >
        −
      </button>
      <input
        className="field-input"
        type="number"
        min={min}
        max={max}
        step={1}
        value={Number.isNaN(value) ? '' : value}
        aria-label={label}
        aria-invalid={!valid}
        onChange={(event) => onChange(event.target.valueAsNumber)}
      />
      <button
        type="button"
        className="icon-btn"
        aria-label={`增加${label}`}
        disabled={valid && value >= max}
        onClick={() => onChange(valid ? value + 1 : min)}
      >
        ＋
      </button>
    </div>
  )
}
