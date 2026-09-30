import { useEffect, useMemo, useState } from 'react'
import type { JSX } from 'react'

import type { PasswordEntryView } from '@shared/types'
import { useAppStore } from '../stores/app-store'
import { CloseIcon, EditIcon, PlusIcon, TrashIcon } from './icons'

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  return '操作失败，请稍后重试'
}

export function PasswordBoxPage(): JSX.Element {
  const entries = useAppStore((state) => state.passwords)
  const refreshPasswords = useAppStore((state) => state.refreshPasswords)
  const savePasswordEntry = useAppStore((state) => state.savePasswordEntry)
  const deletePasswordEntry = useAppStore((state) => state.deletePasswordEntry)
  const togglePasswordFavorite = useAppStore((state) => state.togglePasswordFavorite)
  const importPasswords = useAppStore((state) => state.importPasswords)
  const copyText = useAppStore((state) => state.copyText)

  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<PasswordEntryView | 'new' | null>(null)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [flash, setFlash] = useState('')

  useEffect(() => {
    void refreshPasswords()
  }, [refreshPasswords])

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    if (!keyword) return entries
    return entries.filter(
      (entry) =>
        entry.title.toLowerCase().includes(keyword) ||
        entry.url.toLowerCase().includes(keyword) ||
        entry.account.toLowerCase().includes(keyword)
    )
  }, [entries, query])

  const grouped = useMemo(() => groupByLetter(filtered), [filtered])
  const groups = grouped.groups
  const detail = entries.find((entry) => entry.id === detailId) ?? null

  function showToast(message: string): void {
    setFlash(message)
    window.setTimeout(() => setFlash(''), 1600)
  }

  return (
    <div className="view-enter">
      <div className="toolbar-row">
        <input
          className="field-input"
          style={{ maxWidth: 320 }}
          type="text"
          placeholder="搜索名称、网址或账号…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className="toolbar-grow" />
        {flash ? <span className="toast-inline">{flash}</span> : null}
        <button
          type="button"
          className="btn-ghost"
          onClick={() =>
            void (async () => {
              try {
                const result = await importPasswords()
                if (result) {
                  showToast(`导入 ${result.imported} 条，跳过 ${result.skipped} 条`)
                }
              } catch (error) {
                useAppStore.setState({ error: toErrorMessage(error) })
              }
            })()
          }
        >
          批量导入
        </button>
        <button type="button" className="btn-gold" onClick={() => setEditing('new')}>
          <PlusIcon />
          新增条目
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className="message-empty" style={{ minHeight: 360 }}>
          <div>
            <p className="empty-title">密码宝匣静默如夜</p>
            <p className="empty-text">新增条目，或使用批量导入粘贴固定格式文本。</p>
          </div>
        </div>
      ) : (
        <div className="password-list-wrap">
          {groups.map((group) => (            <div key={group.letter} className="letter-group">
              <div className="letter-header">{group.letter}</div>
              <div className="glass letter-card">
                {group.entries.map((entry) => (
                  <PasswordRow
                    key={entry.id}
                    entry={entry}
                    onOpen={() => setDetailId(entry.id)}
                    onToggleFavorite={() =>
                      void (async () => {
                        try {
                          await togglePasswordFavorite(entry.id, !entry.isFavorite)
                        } catch (error) {
                          useAppStore.setState({ error: toErrorMessage(error) })
                        }
                      })()
                    }
                    onEdit={() => setEditing(entry)}
                    onDelete={() => setConfirmId(entry.id)}
                    confirming={confirmId === entry.id}
                    onCancelDelete={() => setConfirmId(null)}
                    onConfirmDelete={() => {
                      setConfirmId(null)
                      void (async () => {
                        try {
                          await deletePasswordEntry(entry.id)
                          showToast('已删除')
                        } catch (error) {
                          useAppStore.setState({ error: toErrorMessage(error) })
                        }
                      })()
                    }}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {editing ? (
        <PasswordEditor
          initial={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSave={async (input) => {
            try {
              await savePasswordEntry(input)
              setEditing(null)
              showToast('已保存')
            } catch (error) {
              useAppStore.setState({ error: toErrorMessage(error) })
            }
          }}
        />
      ) : null}

      {detail ? (
        <PasswordDetail
          entry={detail}
          onClose={() => setDetailId(null)}
          onEdit={() => {
            setEditing(detail)
            setDetailId(null)
          }}
          onToggleFavorite={() =>
            void (async () => {
              try {
                await togglePasswordFavorite(detail.id, !detail.isFavorite)
              } catch (error) {
                useAppStore.setState({ error: toErrorMessage(error) })
              }
            })()
          }
          copyText={copyText}
        />
      ) : null}
    </div>
  )
}

function PasswordRow({
  entry,
  onOpen,
  onToggleFavorite,
  onEdit,
  onDelete,
  confirming,
  onCancelDelete,
  onConfirmDelete
}: {
  entry: PasswordEntryView
  onOpen: () => void
  onToggleFavorite: () => void
  onEdit: () => void
  onDelete: () => void
  confirming: boolean
  onCancelDelete: () => void
  onConfirmDelete: () => void
}): JSX.Element {
  return (
    <div className="pwd-row">
      <button type="button" className="pwd-main" onClick={onOpen}>
        <span className="pwd-letter-badge">{firstLetter(entry.title)}</span>
        <span className="pwd-text">
          <span className="pwd-title">{entry.title}</span>
          <span className="pwd-sub">{entry.url || '软件（无网址）'}</span>
        </span>
      </button>
      <div className="pwd-actions">
        <button
          type="button"
          className={`icon-btn${entry.isFavorite ? ' fav' : ''}`}
          aria-label={entry.isFavorite ? '取消常用' : '设为常用'}
          onClick={onToggleFavorite}
        >
          ★
        </button>
        <button type="button" className="icon-btn" aria-label="编辑" onClick={onEdit}>
          <EditIcon />
        </button>
        <button type="button" className="icon-btn danger" aria-label="删除" onClick={onDelete}>
          <TrashIcon />
        </button>
      </div>
      {confirming ? (
        <div className="pwd-confirm-row">
          确认删除？
          <button type="button" className="btn-ghost btn-danger" onClick={onConfirmDelete}>
            删除
          </button>
          <button type="button" className="btn-ghost" onClick={onCancelDelete}>
            取消
          </button>
        </div>
      ) : null}
    </div>
  )
}

interface EditorInput {
  title: string
  url: string
  account: string
  password: string
  remark: string
}

function PasswordEditor({
  initial,
  onClose,
  onSave
}: {
  initial: PasswordEntryView | null
  onClose: () => void
  onSave: (input: EditorInput & { id?: string }) => Promise<void>
}): JSX.Element {
  const [form, setForm] = useState<EditorInput>(() => ({
    title: initial?.title ?? '',
    url: initial?.url ?? '',
    account: initial?.account ?? '',
    password: initial?.password ?? '',
    remark: initial?.remark ?? ''
  }))
  const [saving, setSaving] = useState(false)
  const [errorText, setErrorText] = useState('')

  const submit = async (): Promise<void> => {
    if (!form.title.trim()) {
      setErrorText('名称不能为空')
      return
    }
    setSaving(true)
    setErrorText('')
    try {
      await onSave({ ...form, id: initial?.id })
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="密码编辑">
      <div className="glass overlay-card">
        <div className="overlay-head-row">
          <h3 className="panel-title">{initial ? '编辑条目' : '新增条目'}</h3>
          <button type="button" className="icon-btn" aria-label="关闭" onClick={onClose}>
            <CloseIcon />
          </button>
        </div>

        {errorText ? (
          <div className="status-banner" role="alert">
            {errorText}
          </div>
        ) : null}

        <form
          className="settings-grid"
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
        >
          <div>
            <label className="field-label" htmlFor="pwd-title">
              名称
            </label>
            <input
              id="pwd-title"
              className="field-input"
              value={form.title}
              autoFocus
              onChange={(event) => setForm({ ...form, title: event.target.value })}
            />
          </div>
          <div>
            <label className="field-label" htmlFor="pwd-url">
              网址（可选）
            </label>
            <input
              id="pwd-url"
              className="field-input"
              value={form.url}
              placeholder="软件类条目可留空"
              onChange={(event) => setForm({ ...form, url: event.target.value })}
            />
          </div>
          <div>
            <label className="field-label" htmlFor="pwd-account">
              账号
            </label>
            <input
              id="pwd-account"
              className="field-input"
              value={form.account}
              onChange={(event) => setForm({ ...form, account: event.target.value })}
            />
          </div>
          <div>
            <label className="field-label" htmlFor="pwd-password">
              密码
            </label>
            <input
              id="pwd-password"
              className="field-input"
              type="password"
              autoComplete="new-password"
              value={form.password}
              onChange={(event) => setForm({ ...form, password: event.target.value })}
            />
          </div>
          <div>
            <label className="field-label" htmlFor="pwd-remark">
              备注（可选）
            </label>
            <input
              id="pwd-remark"
              className="field-input"
              value={form.remark}
              onChange={(event) => setForm({ ...form, remark: event.target.value })}
            />
          </div>
          <div className="overlay-actions">
            <button type="button" className="btn-ghost" onClick={onClose}>
              取消
            </button>
            <button type="submit" className="btn-gold" disabled={saving}>
              {saving ? '保存中…' : '保存'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function PasswordDetail({
  entry,
  onClose,
  onEdit,
  onToggleFavorite,
  copyText
}: {
  entry: PasswordEntryView
  onClose: () => void
  onEdit: () => void
  onToggleFavorite: () => void
  copyText: (text: string) => Promise<void>
}): JSX.Element {
  const [visible, setVisible] = useState(false)
  const [flashText, setFlashText] = useState('')

  function flash(text: string): void {
    setFlashText(text)
    window.setTimeout(() => setFlashText(''), 1200)
  }

  const copy = async (label: string, value: string): Promise<void> => {
    if (!value) return
    try {
      await copyText(value)
      flash(`已复制${label}`)
    } catch {
      flash('复制失败')
    }
  }

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="条目详情">
      <div className="glass overlay-card">
        <div className="overlay-head-row">
          <h3 className="panel-title">{entry.title}</h3>
          <div className="toolbar-row" style={{ gap: 6 }}>
            <button
              type="button"
              className={`icon-btn${entry.isFavorite ? ' fav' : ''}`}
              aria-label={entry.isFavorite ? '取消常用' : '设为常用'}
              onClick={onToggleFavorite}
            >
              ★
            </button>
            <button type="button" className="icon-btn" aria-label="关闭" onClick={onClose}>
              <CloseIcon />
            </button>
          </div>
        </div>

        {flashText ? (
          <div className="status-banner success-banner" role="status">
            {flashText}
          </div>
        ) : null}

        <DetailField label="名称" value={entry.title} copyable={false} />
        {entry.url ? <DetailField label="网址" value={entry.url} onCopy={() => void copy('网址', entry.url)} /> : null}
        <DetailField label="账号" value={entry.account} onCopy={() => void copy('账号', entry.account)} />

        <div className="field-block">
          <div className="field-row-head">
            <span className="field-label" style={{ marginBottom: 0 }}>
              密码
            </span>
            <div className="toolbar-row" style={{ gap: 6 }}>
              <button type="button" className="btn-ghost" onClick={() => setVisible((v) => !v)}>
                {visible ? '隐藏' : '显示'}
              </button>
              <button
                type="button"
                className="btn-ghost"
                onClick={() => void copy('密码', entry.password)}
              >
                复制
              </button>
            </div>
          </div>
          <div className="field-value mono">{visible ? entry.password : '••••••••••'}</div>
        </div>

        {entry.remark ? <DetailField label="备注" value={entry.remark} copyable={false} /> : null}

        <div className="overlay-actions">
          <button type="button" className="btn-gold" onClick={onEdit}>
            编辑
          </button>
          <button type="button" className="btn-ghost" onClick={onClose}>
            关闭
          </button>
        </div>
      </div>
    </div>
  )
}

function DetailField({
  label,
  value,
  onCopy,
  copyable = true
}: {
  label: string
  value: string
  onCopy?: () => void
  copyable?: boolean
}): JSX.Element | null {
  if (!value) return null
  return (
    <div className="field-block">
      <div className="field-row-head">
        <span className="field-label" style={{ marginBottom: 0 }}>
          {label}
        </span>
        {copyable ? (
          <button type="button" className="btn-ghost" onClick={onCopy}>
            复制
          </button>
        ) : null}
      </div>
      <div className="field-value">{value}</div>
    </div>
  )
}

function groupByLetter(entries: PasswordEntryView[]): {
  groups: Array<{ letter: string; entries: PasswordEntryView[] }>
} {
  const map = new Map<string, PasswordEntryView[]>()
  for (const entry of entries) {
    const letter = firstLetter(entry.title)
    const group = map.get(letter) ?? []
    group.push(entry)
    map.set(letter, group)
  }
  return {
    groups: Array.from(map.entries()).map(([letter, groupEntries]) => ({
      letter,
      entries: groupEntries
    }))
  }
}

function firstLetter(title: string): string {
  const trimmed = title.trim()
  if (!trimmed) return '#'
  const first = trimmed[0]
  if (/[a-zA-Z]/.test(first)) return first.toUpperCase()
  return '#'
}
