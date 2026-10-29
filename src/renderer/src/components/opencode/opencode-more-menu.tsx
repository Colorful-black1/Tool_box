import { useRef, useState } from 'react'
import type { JSX, KeyboardEvent } from 'react'
import { Popover } from '../popover'
import { MoreIcon } from '../icons'

/** 工作台次要操作使用主题浮层，并支持菜单键盘导航与关闭后焦点恢复。 */
export function OpenCodeMoreMenu({
  canSummarize,
  canSync,
  canAttachWorkspace = false,
  onSummarize,
  onSync,
  onAttachWorkspace
}: {
  canSummarize: boolean
  canSync: boolean
  canAttachWorkspace?: boolean
  onSummarize(): void
  onSync(): void
  onAttachWorkspace?: () => void
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const close = (): void => setOpen(false)
  const choose = (action: () => void): void => {
    close()
    trigger.current?.focus()
    action()
  }
  const onKey = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Tab') {
      close()
      trigger.current?.focus()
      return
    }
    const items = [
      ...(menu.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])
    ]
    const index = items.findIndex((item) => item === document.activeElement)
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      items[(index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus()
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      items[event.key === 'Home' ? 0 : items.length - 1]?.focus()
    }
  }
  return (
    <div className="opencode-more">
      <button
        type="button"
        className="btn-ghost"
        ref={trigger}
        aria-label="更多会话操作"
        title="更多会话操作"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault()
            setOpen(true)
          }
        }}
      >
        <MoreIcon />
      </button>
      {open ? (
        <Popover
          anchor={trigger}
          align="right"
          onClose={close}
          onReady={() =>
            menu.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
          }
        >
          <div
            ref={menu}
            className="opencode-more-menu"
            role="menu"
            aria-label="会话操作"
            onKeyDown={onKey}
          >
            <button
              type="button"
              role="menuitem"
              className="btn-ghost"
              disabled={!canSummarize}
              onClick={() => choose(onSummarize)}
            >
              生成交接说明
            </button>
            <button
              type="button"
              role="menuitem"
              className="btn-ghost"
              disabled={!canSync}
              onClick={() => choose(onSync)}
            >
              同步模型
            </button>
            {onAttachWorkspace ? (
              <button
                type="button"
                role="menuitem"
                className="btn-ghost"
                disabled={!canAttachWorkspace}
                onClick={() => choose(onAttachWorkspace)}
              >
                归入 DSH 工作区
              </button>
            ) : null}
          </div>
        </Popover>
      ) : null}
    </div>
  )
}
