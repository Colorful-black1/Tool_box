import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { JSX, KeyboardEvent } from 'react'
import { Popover } from './popover'

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
  id?: string
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
  id,
  align = 'right',
  triggerClassName = '',
  searchable = false,
  ariaLabel
}: DropdownProps): JSX.Element {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const optionId = useId()
  const trigger = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLUListElement>(null)
  const search = useRef<HTMLInputElement>(null)

  const selected = options.find((option) => option.value === value) ?? null

  // 只在打开时复位；父页面的流式更新不能清掉正在输入的过滤词。
  const show = (): void => {
    setQuery('')
    setActive(
      Math.max(
        0,
        options.findIndex((option) => option.value === value)
      )
    )
    setOpen(true)
  }

  const showFilter = searchable && options.length > SEARCHABLE_THRESHOLD
  const visibleOptions = useMemo(() => {
    if (!showFilter) return options
    const keyword = query.trim().toLowerCase()
    if (!keyword) return options
    return options.filter((option) => option.label.toLowerCase().includes(keyword))
  }, [options, query, showFilter])

  useEffect(() => {
    if (open) {
      const option = list.current?.querySelectorAll('[role="option"]').item(active)
      option?.scrollIntoView({ block: 'nearest' })
    }
  }, [active, open])
  useEffect(() => {
    if (disabled) setOpen(false)
  }, [disabled])
  const close = (): void => setOpen(false)
  const choose = (option: DropdownOption): void => {
    close()
    trigger.current?.focus()
    onChange(option.value)
  }
  const onKey = (event: KeyboardEvent): void => {
    if (event.nativeEvent.isComposing) return
    if (event.key === 'Tab') {
      close()
      trigger.current?.focus()
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((index) =>
        Math.max(
          0,
          Math.min(visibleOptions.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1))
        )
      )
    } else if ((event.key === 'Home' || event.key === 'End') && event.target !== search.current) {
      event.preventDefault()
      setActive(event.key === 'Home' ? 0 : Math.max(0, visibleOptions.length - 1))
    } else if (event.key === 'Enter' && visibleOptions[active]) {
      event.preventDefault()
      choose(visibleOptions[active])
    } else if (!showFilter && event.key.length === 1 && !event.ctrlKey && !event.metaKey) {
      const index = visibleOptions.findIndex((option) =>
        option.label.toLowerCase().startsWith(event.key.toLowerCase())
      )
      if (index >= 0) setActive(index)
    }
  }

  return (
    <div className="ui-dropdown">
      <button
        ref={trigger}
        id={id}
        type="button"
        className={`ui-dropdown-trigger${triggerClassName ? ` ${triggerClassName}` : ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => {
          if (open) close()
          else show()
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            show()
          }
        }}
      >
        <span className={`ui-dropdown-label${selected ? '' : ' placeholder'}`}>
          {selected?.label ?? placeholder}
        </span>
        <span className="ui-dropdown-caret" aria-hidden="true">
          ▾
        </span>
      </button>

      {open ? (
        <Popover
          anchor={trigger}
          align={align}
          onClose={close}
          onReady={() => (showFilter ? search.current : list.current)?.focus()}
          className="dropdown-popover"
        >
          {showFilter ? (
            <div className="ui-dropdown-search">
              <input
                ref={search}
                className="ui-dropdown-search-input"
                type="text"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value)
                  setActive(0)
                }}
                onKeyDown={onKey}
                role="combobox"
                aria-expanded="true"
                aria-controls={`${optionId}-options`}
                aria-activedescendant={
                  visibleOptions[active] ? `${optionId}-option-${active}` : undefined
                }
                placeholder="筛选…"
                aria-label={`${ariaLabel} 过滤`}
                autoFocus
              />
            </div>
          ) : null}
          <ul
            ref={list}
            id={`${optionId}-options`}
            className={`ui-dropdown-menu ${align}`}
            role="listbox"
            aria-label={ariaLabel}
            tabIndex={-1}
            onKeyDown={onKey}
            aria-activedescendant={
              visibleOptions[active] ? `${optionId}-option-${active}` : undefined
            }
          >
            {visibleOptions.length === 0 ? (
              <li className="ui-dropdown-empty">暂无可选项</li>
            ) : (
              visibleOptions.map((option, index) => (
                <li key={option.value}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={option.value === value}
                    id={`${optionId}-option-${index}`}
                    tabIndex={-1}
                    className={`ui-dropdown-item${option.value === value ? ' active' : ''}${index === active ? ' highlighted' : ''}`}
                    onMouseMove={() => setActive(index)}
                    onClick={() => choose(option)}
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
        </Popover>
      ) : null}
    </div>
  )
}
