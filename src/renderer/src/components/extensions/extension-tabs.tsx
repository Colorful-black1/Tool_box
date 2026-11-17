import { useRef } from 'react'
import type { JSX, KeyboardEvent } from 'react'

export type ExtensionTab = 'local' | 'search'

export interface ExtensionTabItem {
  value: ExtensionTab
  label: string
}

interface ExtensionTabsProps {
  id: string
  label: string
  value: ExtensionTab
  tabs: ReadonlyArray<ExtensionTabItem>
  onChange: (value: ExtensionTab) => void
}

/** 本机看板与在线搜索分栏；左右方向键、Home、End 可切换。 */
export function ExtensionTabs({
  id,
  label,
  value,
  tabs,
  onChange
}: ExtensionTabsProps): JSX.Element {
  const buttons = useRef<Array<HTMLButtonElement | null>>([])

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    let next: number
    if (event.key === 'ArrowRight') next = (index + 1) % tabs.length
    else if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = tabs.length - 1
    else return
    const target = tabs[next]
    if (!target) return
    event.preventDefault()
    onChange(target.value)
    buttons.current[next]?.focus()
  }

  return (
    <div className="segmented" role="tablist" aria-label={label}>
      {tabs.map((tab, index) => {
        const selected = tab.value === value
        return (
          <button
            key={tab.value}
            ref={(node) => {
              buttons.current[index] = node
            }}
            id={`${id}-tab-${tab.value}`}
            type="button"
            role="tab"
            className={`segment${selected ? ' active' : ''}`}
            aria-selected={selected}
            aria-controls={`${id}-panel-${tab.value}`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(tab.value)}
            onKeyDown={(event) => onKeyDown(event, index)}
          >
            {tab.label}
          </button>
        )
      })}
    </div>
  )
}
