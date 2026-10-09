import { useEffect, useMemo, useState } from 'react'
import type { JSX } from 'react'

import type { BookGroup, BookSummary, BookshelfSort } from '../../../../shared/types'
import { useOverlayEscape } from '../../lib/use-overlay-dismiss'
import { useAppStore } from '../../stores/app-store'
import { useConfigStore } from '../../stores/config-store'
import { BookDetailSheet } from './book-detail-sheet'

/** 与旧项目一致：无封面时按 id 哈希取模轮转色块 */
const CARD_COLORS = ['#5B7C99', '#8A9A5B', '#B0715E', '#7B6D8D', '#4E8069']

const SORT_OPTIONS: Array<{ value: BookshelfSort; label: string }> = [
  { value: 'manual', label: '手动排序' },
  { value: 'recentRead', label: '最近阅读' },
  { value: 'addedTime', label: '添加时间' },
  { value: 'title', label: '书名' }
]

export function BookshelfPage(): JSX.Element {
  const books = useAppStore((state) => state.books)
  const groups = useAppStore((state) => state.groups)
  const refreshBooks = useAppStore((state) => state.refreshBooks)
  const refreshGroups = useAppStore((state) => state.refreshGroups)
  const importBook = useAppStore((state) => state.importBook)
  const deleteBook = useAppStore((state) => state.deleteBook)
  const openReader = useAppStore((state) => state.openReader)
  const createGroup = useAppStore((state) => state.createGroup)
  const deleteGroup = useAppStore((state) => state.deleteGroup)
  const renameGroup = useAppStore((state) => state.renameGroup)
  const setBooksGroup = useAppStore((state) => state.setBooksGroup)
  const reorderBooks = useAppStore((state) => state.reorderBooks)
  const setCover = useAppStore((state) => state.setCover)

  const sort = useConfigStore((state) => state.config.bookshelfSort)
  const patchConfig = useConfigStore((state) => state.patch)

  const [query, setQuery] = useState('')
  const [activeGroup, setActiveGroup] = useState<string | null>(null)
  const [sortOpen, setSortOpen] = useState(false)
  const [editingMode, setEditingMode] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [detail, setDetail] = useState<BookSummary | null>(null)
  const [groupMenu, setGroupMenu] = useState<BookGroup | null>(null)
  const [moveSheet, setMoveSheet] = useState(false)
  const [notice, setNotice] = useState('')

  useEffect(() => {
    void refreshBooks()
    void refreshGroups()
  }, [refreshBooks, refreshGroups])

  const visible = useMemo(() => {
    let list = books

    if (activeGroup !== null) {
      list = list.filter((book) => book.groupId === activeGroup)
    }

    const keyword = query.trim().toLowerCase()
    if (keyword) {
      list = list.filter(
        (book) =>
          book.title.toLowerCase().includes(keyword) ||
          book.author.toLowerCase().includes(keyword)
      )
    }

    if (editingMode || sort === 'manual') {
      return [...list].sort((a, b) => a.sortIndex - b.sortIndex)
    }
    if (sort === 'recentRead') {
      return [...list].sort(
        (a, b) => (b.progress?.updatedAtMs ?? 0) - (a.progress?.updatedAtMs ?? 0)
      )
    }
    if (sort === 'addedTime') {
      return [...list].sort((a, b) => b.createdAtMs - a.createdAtMs)
    }
    return [...list].sort((a, b) => a.title.localeCompare(b.title, 'zh-CN'))
  }, [books, activeGroup, query, sort, editingMode])

  const allSelected = visible.length > 0 && visible.every((book) => selected.has(book.id))

  function toast(message: string): void {
    setNotice(message)
    window.setTimeout(() => setNotice(''), 1800)
  }

  function toggleSelect(id: string): void {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function exitEditing(): void {
    setEditingMode(false)
    setSelected(new Set())
    setMoveSheet(false)
  }

  async function handleCreateGroup(): Promise<void> {
    const name = window.prompt('新建分组（最多 20 字）')
    if (!name?.trim()) return
    const group = await createGroup(name)
    setActiveGroup(group.id)
  }

  async function handleDeleteSelected(): Promise<void> {
    if (selected.size === 0) return
    const ok = window.confirm(
      `确定从书架移除选中的 ${selected.size} 本书吗？\n（不会删除磁盘上的 TXT 文件）`
    )
    if (!ok) return
    for (const id of selected) await deleteBook(id)
    exitEditing()
    toast(`已移除 ${selected.size} 本书`)
  }

  async function handleMoveSelected(groupId: string | null): Promise<void> {
    await setBooksGroup([...selected], groupId)
    exitEditing()
    toast('已移动')
  }

  /** 拖拽排序：把目标书提到最前，其余保持相对顺序 */
  async function handleDrop(targetId: string): Promise<void> {
    if (!editingMode) return
    const ordered = [...books].sort((a, b) => a.sortIndex - b.sortIndex)
    const from = ordered.findIndex((book) => book.id === targetId)
    if (from <= 0) return
    const [moved] = ordered.splice(from, 1)
    ordered.unshift(moved)
    await reorderBooks(ordered.map((book) => book.id))
  }

  return (
    <div className="view-enter bookshelf-page">
      <div className="toolbar-row">
        <input
          className="field-input toolbar-search"
          type="text"
          placeholder="搜索书名 / 作者"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />

        {editingMode ? (
          <>
            <span className="selection-count">已选 {selected.size}</span>
            <button
              type="button"
              className="btn-ghost"
              onClick={() =>
                setSelected(
                  allSelected ? new Set() : new Set(visible.map((book) => book.id))
                )
              }
            >
              {allSelected ? '取消全选' : '全选'}
            </button>
            <button
              type="button"
              className="btn-ghost"
              disabled={selected.size === 0}
              onClick={() => setMoveSheet(true)}
            >
              移动至分组
            </button>
            <button
              type="button"
              className="btn-ghost btn-danger"
              disabled={selected.size === 0}
              onClick={() => void handleDeleteSelected()}
            >
              删除
            </button>
            <button type="button" className="btn-gold" onClick={exitEditing}>
              完成
            </button>
          </>
        ) : (
          <>
            <div className="toolbar-grow" />
            <div className="sort-menu-wrap">
              <button
                type="button"
                className="btn-ghost"
                onClick={() => setSortOpen((open) => !open)}
              >
                {SORT_OPTIONS.find((item) => item.value === sort)?.label} ▾
              </button>
              {sortOpen ? (
                <ul className="sort-menu">
                  {SORT_OPTIONS.map((item) => (
                    <li key={item.value}>
                      <button
                        type="button"
                        className={`sort-item${sort === item.value ? ' active' : ''}`}
                        onClick={() => {
                          void patchConfig({ bookshelfSort: item.value })
                          setSortOpen(false)
                        }}
                      >
                        {item.value === sort ? '✓ ' : ''}
                        {item.label}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => {
                setEditingMode(true)
                setSelected(new Set())
              }}
            >
              管理
            </button>
            <button
              type="button"
              className="btn-gold"
              onClick={() => void importBook()}
            >
              导入 TXT
            </button>
          </>
        )}
      </div>

      <div className="group-filter-bar">
        <button
          type="button"
          className={`group-chip${activeGroup === null ? ' active' : ''}`}
          onClick={() => setActiveGroup(null)}
        >
          全部
        </button>
        {groups.map((group) => (
          <button
            key={group.id}
            type="button"
            className={`group-chip${activeGroup === group.id ? ' active' : ''}`}
            onClick={() => setActiveGroup(group.id)}
            onContextMenu={(event) => {
              event.preventDefault()
              setGroupMenu(group)
            }}
            title="右键管理分组"
          >
            {group.name}
          </button>
        ))}
        <button
          type="button"
          className="group-chip add"
          onClick={() => void handleCreateGroup()}
        >
          ＋ 新建
        </button>
      </div>

      {notice ? <div className="toast-inline bookshelf-notice">{notice}</div> : null}

      {visible.length === 0 ? (
        <div className="message-empty bookshelf-empty">
          <div>
            <p className="empty-title">
              {query ? `没有匹配「${query}」的书籍` : '书架空空如也'}
            </p>
            <p className="empty-text">
              {query ? '换个关键词试试' : '点击右上角「导入 TXT」导入本地小说'}
            </p>
          </div>
        </div>
      ) : (
        <ul className="shelf-grid">
          {visible.map((book) => (
            <li key={book.id}>
              <BookCard
                book={book}
                editing={editingMode}
                selected={selected.has(book.id)}
                onOpen={() => openReader(book.id)}
                onToggleSelect={() => toggleSelect(book.id)}
                onDetail={() => setDetail(book)}
                onDelete={async () => {
                  const ok = window.confirm(
                    `确定删除「${book.title}」吗？该操作不可恢复。`
                  )
                  if (!ok) return
                  await deleteBook(book.id)
                  toast('已删除')
                }}
                onSetCover={async () => {
                  await setCover(book.id)
                  toast('封面已更新')
                }}
                onMove={() => {
                  setSelected(new Set([book.id]))
                  setMoveSheet(true)
                }}
                onDrop={() => void handleDrop(book.id)}
              />
            </li>
          ))}
        </ul>
      )}

      {detail ? (
        <BookDetailSheet
          book={detail}
          onClose={() => setDetail(null)}
          onSaved={async () => {
            setDetail(null)
            await refreshBooks()
            toast('已保存')
          }}
        />
      ) : null}

      {groupMenu ? (
        <GroupManageDialog
          group={groupMenu}
          onClose={() => setGroupMenu(null)}
          onRename={async (name) => {
            await renameGroup(groupMenu.id, name)
            setGroupMenu(null)
            await refreshGroups()
          }}
          onDelete={async () => {
            if (
              !window.confirm(
                `删除分组「${groupMenu.name}」？分组内书籍将回到「全部」。`
              )
            ) {
              return
            }
            if (activeGroup === groupMenu.id) setActiveGroup(null)
            await deleteGroup(groupMenu.id)
            setGroupMenu(null)
            await refreshGroups()
            await refreshBooks()
          }}
        />
      ) : null}

      {moveSheet ? (
        <MoveToGroupSheet
          groups={groups}
          count={selected.size}
          onClose={() => setMoveSheet(false)}
          onPick={(groupId) => void handleMoveSelected(groupId)}
          onCreateAndMove={async (name) => {
            const group = await createGroup(name)
            await handleMoveSelected(group.id)
          }}
        />
      ) : null}
    </div>
  )
}

interface BookCardProps {
  book: BookSummary
  editing: boolean
  selected: boolean
  onOpen(): void
  onToggleSelect(): void
  onDetail(): void
  onDelete(): void
  onSetCover(): void
  onMove(): void
  onDrop(): void
}

function BookCard(props: BookCardProps): JSX.Element {
  const { book } = props
  const color = useMemo(() => {
    let hash = 0
    for (const char of book.id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
    return CARD_COLORS[hash % CARD_COLORS.length]
  }, [book.id])

  const percent = Math.round((book.progress?.percent ?? 0) * 100)

  return (
    <div
      className={`book-card${props.selected ? ' selected' : ''}`}
      draggable={props.editing}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault()
        props.onDrop()
      }}
    >
      <div className="book-cover-wrap">
        <button type="button" className="book-cover" onClick={props.onOpen}>
          {book.coverPath ? (
            <img src={toFileUrl(book.coverPath)} alt={book.title} />
          ) : (
            <div className="cover-art" style={{ background: color }}>
              <span className="cover-title">{book.title}</span>
            </div>
          )}

          {props.editing ? (
            <span
              className={`select-check${props.selected ? ' on' : ''}`}
              onClick={(event) => {
                event.stopPropagation()
                props.onToggleSelect()
              }}
              role="checkbox"
              aria-checked={props.selected}
              aria-label={`选择 ${book.title}`}
            />
          ) : null}
        </button>

        {!props.editing ? (
          // 悬浮操作条：与封面按钮平级（避免 button 嵌套），锚定在封面底部
          <div
            className="book-hover-actions"
            onClick={(event) => event.stopPropagation()}
          >
            <button type="button" className="btn-ghost" onClick={props.onSetCover}>
              换封面
            </button>
            <button type="button" className="btn-ghost" onClick={props.onMove}>
              移动
            </button>
            <button type="button" className="btn-ghost btn-danger" onClick={props.onDelete}>
              删除
            </button>
          </div>
        ) : null}
      </div>

      <div className="book-meta">
        <div className="book-name" title={book.title}>
          {book.title}
        </div>
        {book.author ? <div className="book-author">{book.author}</div> : null}
        <div className="book-stats">
          {book.chapterCount} 章
          {book.progress ? ` · 第 ${book.progress.chapterIdx + 1} 章` : ''}
        </div>
        <div className="book-progress" title={percent > 0 ? `${percent}%` : '尚未开始'}>
          <span style={{ width: `${percent}%` }} />
        </div>
      </div>

      {!props.editing ? (
        <div className="book-card-menu">
          <button
            type="button"
            className="icon-btn"
            aria-label="更多操作"
            onClick={props.onDetail}
          >
            ⋯
          </button>
        </div>
      ) : null}
    </div>
  )
}

function GroupManageDialog(props: {
  group: BookGroup
  onClose(): void
  onRename(name: string): Promise<void>
  onDelete(): Promise<void>
}): JSX.Element {
  const [name, setName] = useState(props.group.name)
  useOverlayEscape(props.onClose)
  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="分组管理" onClick={props.onClose}>
      <div
        className="glass overlay-card"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="overlay-head-row">
          <h3 className="panel-title">分组管理</h3>
        </div>
        <div className="settings-grid">
          <div>
            <label className="field-label" htmlFor="group-rename">
              重命名分组
            </label>
            <input
              id="group-rename"
              className="field-input"
              value={name}
              maxLength={20}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="overlay-actions">
            <button
              type="button"
              className="btn-ghost btn-danger"
              onClick={() => void props.onDelete()}
            >
              删除分组
            </button>
            <button type="button" className="btn-ghost" onClick={props.onClose}>
              取消
            </button>
            <button
              type="button"
              className="btn-gold"
              onClick={() => void props.onRename(name)}
            >
              保存
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function MoveToGroupSheet(props: {
  groups: BookGroup[]
  count: number
  onClose(): void
  onPick(groupId: string | null): void
  onCreateAndMove(name: string): Promise<void>
}): JSX.Element {
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  useOverlayEscape(props.onClose)

  return (
    <div className="sheet-backdrop" onClick={props.onClose} role="presentation">
      <div
        className="sheet-panel move-sheet"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-label="移动至分组"
      >
        <div className="sheet-tabs">
          <span className="sheet-tab active static">移动 {props.count} 本书至</span>
          <button
            type="button"
            className="sheet-close"
            aria-label="关闭"
            onClick={props.onClose}
          >
            ✕
          </button>
        </div>
        <div className="sheet-scroll">
          <ul className="move-list">
            <li>
              <button type="button" className="toc-item" onClick={() => props.onPick(null)}>
                移出分组
              </button>
            </li>
            {props.groups.map((group) => (
              <li key={group.id}>
                <button
                  type="button"
                  className="toc-item"
                  onClick={() => props.onPick(group.id)}
                >
                  {group.name}
                </button>
              </li>
            ))}
            <li>
              {creating ? (
                <div className="move-create">
                  <input
                    className="field-input"
                    value={name}
                    maxLength={20}
                    autoFocus
                    placeholder="新分组名称"
                    onChange={(event) => setName(event.target.value)}
                  />
                  <button
                    type="button"
                    className="btn-gold"
                    onClick={() => {
                      if (name.trim()) void props.onCreateAndMove(name)
                    }}
                  >
                    创建并移动
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className="toc-item"
                  onClick={() => setCreating(true)}
                >
                  ＋ 新建分组
                </button>
              )}
            </li>
          </ul>
        </div>
      </div>
    </div>
  )
}

/** 主进程返回绝对路径；renderer 用 file:// 协议加载受管封面 */
function toFileUrl(absolutePath: string): string {
  return `file:///${absolutePath.replaceAll('\\', '/')}`
}