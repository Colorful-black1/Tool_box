import { useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'

import { useOverlayEscape } from '../lib/use-overlay-dismiss'

export interface DropdownOption {
  value: string
  label: string
}

interface DropdownProps {
  value: string
  options: DropdownOption[]
  onChange: (value: string) => void
  /** 未选中任何项时的占位文案 */
  placeholder?: string
  disabled?: boolean
  /** 菜单展开方向（默认右对齐，贴容器右缘） */
  align?: 'left' | 'right'
  /** 触发按钮附加类名，用于尺寸/色彩微调 */
  triggerClassName?: string
  ariaLabel: string
}

/**
 * 统一风格的下拉选择器（对齐 `.sort-menu` 的星轨范式）。
 *
 * 项目内禁止直接使用原生 `<select>` 做可见交互控件——原生弹层无法跟随
 * 深色主题，视觉会与整体风格割裂。需要下拉时一律复用本组件。
 */
export function Dropdown({
  value,
  options,
  onChange,
  placeholder = '请选择',
  disabled = false,
  align = 'right',
  triggerClassName = '',
  ariaLabel
}: DropdownProps): JSX.Element {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useOverlayEscape(() => setOpen(false))

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent): void => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [open])

  const selected = options.find((option) => option.value === value) ?? null

  return (
    <div className="ui-dropdown" ref={wrapRef}>
      <button
        type="button"
        className={`ui-dropdown-trigger${triggerClassName ? ` ${triggerClassName}` : ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
      >
        <span className={`ui-dropdown-label${selected ? '' : ' placeholder'}`}>
          {selected?.label ?? placeholder}
        </span>
        <span className="ui-dropdown-caret" aria-hidden="true">
          ▾
        </span>
      </button>

      {open ? (
        <ul className={`ui-dropdown-menu ${align}`} role="listbox" aria-label={ariaLabel}>
          {options.length === 0 ? (
            <li className="ui-dropdown-empty">暂无可选项</li>
          ) : (
            options.map((option) => (
              <li key={option.value}>
                <button
                  type="button"
                  role="option"
                  aria-selected={option.value === value}
                  className={`ui-dropdown-item${option.value === value ? ' active' : ''}`}
                  onClick={() => {
                    onChange(option.value)
                    setOpen(false)
                  }}
                >
                  <span className="ui-dropdown-tick" aria-hidden="true">
                    {option.value === value ? '✓' : ''}
                  </span>
                  <span className="ui-dropdown-item-label">{option.label}</span>
                </button>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  )
}
