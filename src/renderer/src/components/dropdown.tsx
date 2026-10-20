import { useEffect, useMemo, useRef, useState } from 'react'
import type { JSX } from 'react'

import { useOverlayEscape } from '../lib/use-overlay-dismiss'

export interface DropdownOption {
  value: string
  label: string
}

/** 超过这个数量的选项就显示过滤框 */
const SEARCHABLE_THRESHOLD = 8

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
  /**
   * 选项较多时（超过 {@link SEARCHABLE_THRESHOLD} 条）在菜单顶部显示过滤框。
   * 模型列表动辄三四十条，没有过滤框基本没法找。
   */
  searchable?: boolean
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
  searchable = false,
  ariaLabel
}: DropdownProps): JSX.Element {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
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

  // 每次打开都清掉上一次的过滤词，避免下次进来是空的
  useEffect(() => {
    if (open) setQuery('')
  }, [open])

  const showFilter = searchable && options.length > SEARCHABLE_THRESHOLD
  const visibleOptions = useMemo(() => {
    if (!showFilter) return options
    const keyword = query.trim().toLowerCase()
    if (!keyword) return options
    return options.filter((option) => option.label.toLowerCase().includes(keyword))
  }, [options, query, showFilter])

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
          {showFilter ? (
            <li className="ui-dropdown-search">
              <input
                className="ui-dropdown-search-input"
                type="text"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="筛选…"
                aria-label={`${ariaLabel} 过滤`}
                autoFocus
              />
            </li>
          ) : null}
          {visibleOptions.length === 0 ? (
            <li className="ui-dropdown-empty">暂无可选项</li>
          ) : (
            visibleOptions.map((option) => (
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
