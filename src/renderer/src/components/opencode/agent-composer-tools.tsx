import { useEffect, useRef, useState } from 'react'
import type { JSX, KeyboardEvent } from 'react'
import { CodeIcon, EditIcon, FolderIcon, PlusIcon } from '../icons'
import { Popover } from '../popover'

type InputTool = 'files' | 'commands' | 'skills' | 'mcp' | 'notes'
const INPUT_TOOLS: Array<{ id: InputTool; label: string; key: string }> = [
  { id: 'files', label: '引用文件', key: '@' },
  { id: 'notes', label: '引用笔记', key: '' },
  { id: 'commands', label: '命令', key: '/' },
  { id: 'skills', label: 'Skill', key: '' },
  { id: 'mcp', label: 'MCP', key: '' }
]

/** 添加菜单仅打开已有候选面板，选择菜单项本身不创建或发送任务。 */
export function AgentComposerTools({
  disabled,
  onChoose
}: {
  disabled: boolean
  onChoose(tool: InputTool): void
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const anchor = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (disabled) setOpen(false)
  }, [disabled])
  const onKey = (event: KeyboardEvent<HTMLDivElement>): void => {
    const items = [...(menu.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
    const index = items.findIndex((item) => item === document.activeElement)
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      items[(index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus()
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      items[event.key === 'Home' ? 0 : items.length - 1]?.focus()
    } else if (event.key === 'Tab') {
      setOpen(false)
      anchor.current?.focus()
    }
  }
  return (
    <div className="agent-input-tools">
      <button
        type="button"
        className="icon-btn"
        ref={anchor}
        aria-label="添加文件或工具"
        title="添加文件或工具"
        aria-expanded={open && !disabled}
        aria-haspopup="menu"
        disabled={disabled}
        onClick={() => setOpen(!open)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault()
            setOpen(true)
          }
        }}
      >
        <PlusIcon />
      </button>
      {open && !disabled ? (
        <Popover
          anchor={anchor}
          placement="top"
          matchAnchorWidth={false}
          onClose={() => setOpen(false)}
          onReady={() => menu.current?.querySelector<HTMLButtonElement>('button')?.focus()}
        >
          <div
            className="agent-input-menu"
            role="menu"
            aria-label="添加文件或工具"
            ref={menu}
            onKeyDown={onKey}
          >
            {INPUT_TOOLS.map((tool) => (
              <button
                key={tool.id}
                type="button"
                role="menuitem"
                className="btn-ghost"
                onClick={() => {
                  setOpen(false)
                  onChoose(tool.id)
                }}
              >
                {tool.id === 'files' ? (
                  <FolderIcon />
                ) : tool.id === 'notes' ? (
                  <EditIcon />
                ) : (
                  <CodeIcon />
                )}
                <span>{tool.label}</span>
                <kbd>{tool.key}</kbd>
              </button>
            ))}
          </div>
        </Popover>
      ) : null}
    </div>
  )
}
