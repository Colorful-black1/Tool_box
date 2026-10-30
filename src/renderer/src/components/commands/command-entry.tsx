import { useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import type { DeveloperCommand } from '@shared/developer-commands'
import { COMMAND_RISK_LABELS, COMMAND_SHELL_LABELS } from '@shared/developer-commands'
import { Dropdown } from '../dropdown'
import { FavoriteIcon } from '../icons'
import { confirmDialog } from '../../stores/dialog-store'
import { useDeveloperCommandStore } from '../../stores/developer-command-store'

/** 结果直接可复制；更多菜单只管理记录，不运行命令。 */
export function CommandEntry({
  entry,
  favorite,
  disabled,
  onEdit
}: {
  entry: DeveloperCommand
  favorite: boolean
  disabled: boolean
  onEdit(entry: DeveloperCommand): void
}): JSX.Element {
  const setFavorite = useDeveloperCommandStore((state) => state.favorite)
  const archive = useDeveloperCommandStore((state) => state.archive)
  const [copied, setCopied] = useState(false)
  const [copying, setCopying] = useState(false)
  const [error, setError] = useState('')
  const [expanded, setExpanded] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  useEffect(() => {
    clearTimeout(timer.current)
    setCopied(false)
    setError('')
  }, [entry.command])
  const personal = entry.id.startsWith('user:')
  const archived = entry.archivedAtMs !== null
  const copy = async (): Promise<void> => {
    if (copying) return
    setCopying(true)
    setError('')
    try {
      if (!window.toolbox?.system?.copyText) throw new Error('剪贴板尚未就绪')
      await window.toolbox.system.copyText(entry.command)
      setCopied(true)
      clearTimeout(timer.current)
      timer.current = setTimeout(() => setCopied(false), 1600)
    } catch {
      setCopied(false)
      setError('复制失败，请重试或手动选择命令复制')
    } finally {
      setCopying(false)
    }
  }
  return (
    <article className="command-entry" data-command-id={entry.id}>
      <div className="command-entry-head">
        <h2>
          <button
            type="button"
            className="btn-ghost command-entry-title"
            aria-expanded={expanded}
            onClick={() => setExpanded((value) => !value)}
            title="展开用途与说明"
          >
            {entry.title}
          </button>
        </h2>
        <span className="command-origin">{personal ? '我的' : '内置'}</span>
        <div className="command-entry-actions">
          <button
            type="button"
            className={`icon-btn${favorite ? ' is-favorite' : ''}`}
            aria-label={`${favorite ? '取消收藏' : '收藏'}：${entry.title}`}
            aria-pressed={favorite}
            title={favorite ? '取消收藏' : '收藏'}
            disabled={disabled || archived}
            onClick={() => void setFavorite(entry.id, !favorite)}
          >
            <FavoriteIcon />
          </button>
          <button
            type="button"
            className="btn-ghost"
            disabled={copying}
            onClick={() => void copy()}
            aria-label={`复制：${entry.title}`}
          >
            {copied ? '已复制' : '复制'}
          </button>
          {archived ? (
            <button
              type="button"
              className="btn-ghost"
              disabled={disabled}
              onClick={() => void archive(entry.id, false)}
            >
              恢复
            </button>
          ) : (
            <Dropdown
              ariaLabel={`更多：${entry.title}`}
              value=""
              placeholder="更多"
              disabled={disabled}
              options={
                personal
                  ? [
                      { value: 'edit', label: '编辑' },
                      { value: 'archive', label: '归档' }
                    ]
                  : [{ value: 'edit', label: '另存为我的命令' }]
              }
              onChange={(action) => {
                if (action === 'edit') onEdit(entry)
                else
                  void confirmDialog(`归档「${entry.title}」？之后可在归档中恢复。`).then((ok) => {
                    if (ok) void archive(entry.id, true)
                  })
              }}
            />
          )}
        </div>
      </div>
      <pre className="command-code" tabIndex={0} aria-label={`${entry.title}命令`}>
        <code>{entry.command}</code>
      </pre>
      <div className="command-entry-meta">
        <span>{entry.category}</span>
        <span>{COMMAND_SHELL_LABELS[entry.shell]}</span>
        {entry.risk !== 'read' ? (
          <span className="command-risk">{COMMAND_RISK_LABELS[entry.risk]}</span>
        ) : null}
        {entry.tags.map((tag) => (
          <span key={tag}>#{tag}</span>
        ))}
      </div>
      {expanded ? <p className="command-description">{entry.description || '暂无说明'}</p> : null}
      {error ? (
        <p className="status-banner" role="alert">
          {error}
        </p>
      ) : null}
      <span className="sr-only" role="status">
        {copied ? '命令已复制' : ''}
      </span>
    </article>
  )
}
