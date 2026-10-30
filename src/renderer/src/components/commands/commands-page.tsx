import { useEffect, useMemo, useRef, useState } from 'react'
import type { JSX } from 'react'
import { DEVELOPER_COMMAND_PRESETS } from '@shared/developer-command-presets'
import {
  COMMAND_SHELLS,
  COMMAND_SHELL_LABELS,
  searchDeveloperCommands
} from '@shared/developer-commands'
import type { CommandLibraryView, DeveloperCommand } from '@shared/developer-commands'
import { useDeveloperCommandStore } from '../../stores/developer-command-store'
import { Dropdown } from '../dropdown'
import { SearchIcon } from '../icons'
import { CommandEditor } from './command-editor'
import { CommandEntry } from './command-entry'

const VIEWS: Array<{ value: CommandLibraryView; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'favorites', label: '收藏' },
  { value: 'mine', label: '我的' },
  { value: 'archived', label: '归档' }
]

/** 工作台独立入口；过滤驻留内存，列表正文始终作为普通文本。 */
export function CommandsPage(): JSX.Element {
  const snapshot = useDeveloperCommandStore((state) => state.snapshot)
  const filters = useDeveloperCommandStore((state) => state.filters)
  const loading = useDeveloperCommandStore((state) => state.loading)
  const saving = useDeveloperCommandStore((state) => state.saving)
  const ready = useDeveloperCommandStore((state) => state.ready)
  const error = useDeveloperCommandStore((state) => state.error)
  const filter = useDeveloperCommandStore((state) => state.filter)
  const load = useDeveloperCommandStore((state) => state.load)
  const [editing, setEditing] = useState<DeveloperCommand | 'new' | null>(null)
  const search = useRef<HTMLInputElement>(null)
  const results = useRef<HTMLDivElement>(null)
  useEffect(() => {
    void load()
    const focus = (): void => {
      void load()
    }
    const key = (event: KeyboardEvent): void => {
      if (
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === 'f' &&
        !document.querySelector('[role="dialog"], [data-app-dialog]')
      ) {
        event.preventDefault()
        search.current?.focus()
        search.current?.select()
      }
    }
    window.addEventListener('focus', focus)
    window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('focus', focus)
      window.removeEventListener('keydown', key)
    }
  }, [load])
  const entries = useMemo(
    () => [...DEVELOPER_COMMAND_PRESETS, ...snapshot.entries],
    [snapshot.entries]
  )
  const categories = useMemo(() => [...new Set(entries.map((entry) => entry.category))], [entries])
  const visible = useMemo(
    () => searchDeveloperCommands(entries, snapshot.favoriteIds, filters),
    [entries, snapshot.favoriteIds, filters]
  )
  const disabled = loading || saving || !ready
  return (
    <section className="commands-page view-enter" aria-label="命令速查">
      <div className="command-toolbar">
        <label className="command-search">
          <SearchIcon />
          <input
            ref={search}
            className="field-input"
            aria-label="搜索命令"
            placeholder="搜索标题、命令或用途…"
            maxLength={100}
            value={filters.query}
            onChange={(event) => filter({ query: event.target.value })}
          />
        </label>
        <button
          type="button"
          className="btn-ghost"
          disabled={loading || saving}
          onClick={() => void load()}
        >
          {loading ? '读取中…' : '刷新'}
        </button>
        <button
          type="button"
          className="btn-gold"
          disabled={disabled}
          onClick={() => setEditing('new')}
        >
          新增命令
        </button>
      </div>
      <div className="command-filterbar">
        <div className="command-view-filters" aria-label="命令视图">
          {VIEWS.map((view) => (
            <button
              type="button"
              key={view.value}
              className={`btn-ghost${filters.view === view.value ? ' active' : ''}`}
              aria-pressed={filters.view === view.value}
              onClick={() => filter({ view: view.value })}
            >
              {view.label}
            </button>
          ))}
        </div>
        <Dropdown
          ariaLabel="筛选 Shell"
          value={filters.shell}
          options={[
            { value: '', label: '全部 Shell' },
            ...COMMAND_SHELLS.map((value) => ({ value, label: COMMAND_SHELL_LABELS[value] }))
          ]}
          onChange={(shell) => filter({ shell })}
        />
        <span className="command-count" role="status">
          {visible.length} 条
        </span>
        {filters.query || filters.category || filters.shell || filters.view !== 'all' ? (
          <button
            type="button"
            className="btn-ghost"
            onClick={() => filter({ query: '', category: '', shell: '', view: 'all' })}
          >
            清空筛选
          </button>
        ) : null}
      </div>
      {error ? (
        <p className="status-banner" role="alert">
          {error}
        </p>
      ) : null}
      <div className="command-layout">
        <nav className="command-categories glass" aria-label="命令分类">
          {['', ...categories].map((category) => (
            <button
              type="button"
              key={category}
              className={`btn-ghost${filters.category === category ? ' active' : ''}`}
              aria-pressed={filters.category === category}
              onClick={() => filter({ category })}
            >
              {category || '全部分类'}
            </button>
          ))}
        </nav>
        <div
          className="command-results glass"
          aria-label="命令结果"
          aria-busy={loading}
          ref={results}
          onKeyDown={(event) => {
            if (
              !(event.target instanceof HTMLElement) ||
              !event.target.matches('.command-entry-title')
            )
              return
            const titles = [
              ...(results.current?.querySelectorAll<HTMLButtonElement>('.command-entry-title') ??
                [])
            ]
            const index = titles.indexOf(event.target as HTMLButtonElement)
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault()
              titles[
                Math.max(
                  0,
                  Math.min(titles.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1))
                )
              ]?.focus()
            }
          }}
        >
          {!visible.length ? (
            <div className="command-empty">
              <p>{loading ? '正在读取…' : '没有匹配的命令'}</p>
              <p className="field-hint">试试其他关键词，或新增自己的命令。</p>
            </div>
          ) : null}
          {visible.map((entry) => (
            <CommandEntry
              key={entry.id}
              entry={entry}
              favorite={snapshot.favoriteIds.includes(entry.id)}
              disabled={disabled}
              onEdit={setEditing}
            />
          ))}
        </div>
      </div>
      {editing ? (
        <CommandEditor
          entry={editing === 'new' ? undefined : editing}
          categories={categories}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </section>
  )
}
